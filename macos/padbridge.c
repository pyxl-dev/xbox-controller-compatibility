// Pont manettes pour Super Mario 3D World + Bowser's Fury (portage natif nxnative/dmhost).
// Bibliothèque chargée dans dmhost avec DYLD_INSERT_LIBRARIES : elle lit les manettes que
// GameController.framework ignore (PowerA filaire Switch en HID) et les donne au jeu via ses
// fonctions exportées dm_pad_set_player / dm_pad_players.
// Compilée avec -DPADBRIDGE_STANDALONE, elle devient un petit outil qui affiche les boutons lus.
#include <CoreFoundation/CoreFoundation.h>
#include <IOKit/hid/IOHIDManager.h>
#include <dispatch/dispatch.h>
#include <mach-o/dyld.h>
#include <mach-o/nlist.h>
#include <mach-o/stab.h>
#include <dlfcn.h>
#include <pthread.h>
#include <stdatomic.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define MAX_PLAYERS 8
#define REPORT_SIZE 8
#define STICK_DEADZONE 8   // sur 127, autour du centre 0x80

// Boutons au format npad du jeu (bits de nn::hid::NpadButton, vus dans _pad_read)
enum {
  NPAD_A = 1ull << 0, NPAD_B = 1ull << 1, NPAD_X = 1ull << 2, NPAD_Y = 1ull << 3,
  NPAD_LS = 1ull << 4, NPAD_RS = 1ull << 5, NPAD_L = 1ull << 6, NPAD_R = 1ull << 7,
  NPAD_ZL = 1ull << 8, NPAD_ZR = 1ull << 9, NPAD_PLUS = 1ull << 10, NPAD_MINUS = 1ull << 11,
  NPAD_LEFT = 1ull << 12, NPAD_UP = 1ull << 13, NPAD_RIGHT = 1ull << 14, NPAD_DOWN = 1ull << 15,
  NPAD_SHAKE = 1ull << 63,   // secousse simulée, gérée par dm_pad_set_player pour le joueur 1
};

// Manettes reconnues : rapport HID de 8 octets sans numéro de rapport
// [boutons 0-7][boutons 8-13][croix 0-7, 8+ = neutre][X][Y][Z][Rz][bourrage]
static const struct { uint32_t vid, pid; const char *name; } known_pads[] = {
  { 0x20d6, 0xa713, "PowerA NSW wired controller" },
};

// Bouton HID n (bit n du rapport) -> bouton npad, disposition Switch : A reste A
static const uint64_t hid_buttons[14] = {
  NPAD_Y, NPAD_B, NPAD_A, NPAD_X, NPAD_L, NPAD_R, NPAD_ZL, NPAD_ZR,
  NPAD_MINUS, NPAD_PLUS, NPAD_LS, NPAD_RS, 0 /* Home */, NPAD_SHAKE /* Capture */,
};

static const uint64_t hat_dirs[8] = {
  NPAD_UP, NPAD_UP | NPAD_RIGHT, NPAD_RIGHT, NPAD_DOWN | NPAD_RIGHT,
  NPAD_DOWN, NPAD_DOWN | NPAD_LEFT, NPAD_LEFT, NPAD_UP | NPAD_LEFT,
};

typedef struct {
  IOHIDDeviceRef device;
  const char *name;
  _Atomic int player;   // -1 tant qu'aucun joueur n'est réservé
  uint8_t report[REPORT_SIZE];
  uint8_t shown[REPORT_SIZE];   // outil de test : dernier rapport affiché
} pad_t;

#define LOG(...) do { fprintf(stderr, "[padbridge] " __VA_ARGS__); fputc('\n', stderr); } while (0)

#ifndef PADBRIDGE_STANDALONE

static void (*game_set_player)(unsigned, uint64_t, int, int, int, int);
static void (*game_players)(unsigned);
static intptr_t *game_slots;          // g_slots[8] : GCController de chaque joueur (non exporté)
static volatile uint8_t *game_input_off;   // g_input_on : 1 quand le jeu a relâché les entrées
static volatile int *game_merge;      // g_merge : DM_PAD_MERGE, toutes les manettes en joueur 1

// Marqueur rangé dans g_slots pour nos joueurs : le jeu ne fait que comparer ces valeurs
// à ses GCController (vérifié avec Ghidra), il ne les déréférence jamais.
#define SLOT_MARK ((intptr_t)0x9ad0b71d9e000001)

static int verbose;

#endif

static int clamp_axis(int raw, int invert) {
  int v = raw - 0x80;
  if (v > -STICK_DEADZONE && v < STICK_DEADZONE) return 0;
  if (invert) v = -v;
  int out = v * 32767 / 127;
  return out > 32767 ? 32767 : out < -32767 ? -32767 : out;
}

static uint64_t decode_buttons(const uint8_t *r) {
  uint16_t bits = (uint16_t)(r[0] | r[1] << 8);
  uint64_t out = 0;
  for (int i = 0; i < 14; i++)
    if (bits & (1u << i)) out |= hid_buttons[i];
  uint8_t hat = r[2] & 0x0f;
  if (hat < 8) out |= hat_dirs[hat];
  return out;
}

#ifdef PADBRIDGE_STANDALONE

static const char *button_names[64] = {
  [0] = "A", [1] = "B", [2] = "X", [3] = "Y", [4] = "LS", [5] = "RS", [6] = "L", [7] = "R",
  [8] = "ZL", [9] = "ZR", [10] = "+", [11] = "-", [12] = "gauche", [13] = "haut",
  [14] = "droite", [15] = "bas", [63] = "secousse",
};

static void pad_report(pad_t *pad) {
  if (!memcmp(pad->shown, pad->report, sizeof pad->report)) return;
  memcpy(pad->shown, pad->report, sizeof pad->report);
  uint64_t btn = decode_buttons(pad->report);
  printf("%-28s", pad->name);
  for (int i = 0; i < 64; i++)
    if ((btn >> i & 1) && button_names[i]) printf(" %s", button_names[i]);
  printf("  | gauche %6d %6d  droit %6d %6d\n",
         clamp_axis(pad->report[3], 0), clamp_axis(pad->report[4], 1),
         clamp_axis(pad->report[5], 0), clamp_axis(pad->report[6], 1));
  fflush(stdout);
}

static void pad_attached(pad_t *pad) { printf("branchée : %s\n", pad->name); }
static void pad_detached(pad_t *pad) { printf("débranchée : %s\n", pad->name); }

#else

// Cherche un symbole local (non exporté) de dmhost dans sa table des symboles en mémoire.
// sibling : si plusieurs symboles portent ce nom, garde celui du même fichier source que ce
// symbole-là (d'après la carte de débogage N_OSO / N_STSYM). Ambigu sans elle : NULL.
static void *local_symbol(const char *name, const char *sibling) {
  // L'image de dmhost est celle qui contient dm_pad_set_player : avec DYLD_INSERT_LIBRARIES,
  // l'image numéro 0 n'est pas forcément l'exécutable.
  Dl_info info;
  if (!game_set_player || !dladdr((void *)game_set_player, &info) || !info.dli_fbase) return NULL;
  const struct mach_header_64 *mh = info.dli_fbase;
  const struct segment_command_64 *text = NULL, *linkedit = NULL;
  const struct symtab_command *symtab = NULL;
  const struct load_command *lc = (const struct load_command *)(mh + 1);
  for (uint32_t i = 0; i < mh->ncmds; i++) {
    if (lc->cmd == LC_SEGMENT_64) {
      const struct segment_command_64 *seg = (const struct segment_command_64 *)lc;
      if (!strcmp(seg->segname, "__TEXT")) text = seg;
      else if (!strcmp(seg->segname, "__LINKEDIT")) linkedit = seg;
    } else if (lc->cmd == LC_SYMTAB) {
      symtab = (const struct symtab_command *)lc;
    }
    lc = (const struct load_command *)((const char *)lc + lc->cmdsize);
  }
  if (!text || !linkedit || !symtab) return NULL;
  intptr_t slide = (intptr_t)mh - (intptr_t)text->vmaddr;
  uintptr_t base = (uintptr_t)slide + linkedit->vmaddr - linkedit->fileoff;
  const struct nlist_64 *syms = (const struct nlist_64 *)(base + symtab->symoff);
  const char *strs = (const char *)(base + symtab->stroff);
  uintptr_t found = 0, by_file = 0;
  int count = 0, object = 0, sibling_object = -1, name_objects[8], name_count = 0;
  uintptr_t name_addrs[8];
  for (uint32_t i = 0; i < symtab->nsyms; i++) {
    const char *s = strs + syms[i].n_un.n_strx;
    uint8_t type = syms[i].n_type;
    if (type == N_OSO) { object++; continue; }
    if (type == N_STSYM) {
      if (sibling && !strcmp(s, sibling)) sibling_object = object;
      if (!strcmp(s, name) && name_count < 8) {
        name_objects[name_count] = object;
        name_addrs[name_count++] = (uintptr_t)slide + syms[i].n_value;
      }
      continue;
    }
    if ((type & N_STAB) || (type & N_TYPE) != N_SECT || strcmp(s, name)) continue;
    found = (uintptr_t)slide + syms[i].n_value;
    count++;
  }
  for (int i = 0; i < name_count; i++)
    if (name_objects[i] == sibling_object) by_file = name_addrs[i];
  if (count == 1) return (void *)found;
  return (void *)by_file;
}

static int resolve_game(void) {
  game_set_player = (void (*)(unsigned, uint64_t, int, int, int, int))dlsym(RTLD_DEFAULT, "dm_pad_set_player");
  game_players = (void (*)(unsigned))dlsym(RTLD_DEFAULT, "dm_pad_players");
  game_merge = local_symbol("_g_merge", NULL);
  game_input_off = local_symbol("_g_input_on", NULL);
  // Deux symboles _g_slots existent : celui des manettes est dans le même fichier que _g_merge
  game_slots = local_symbol("_g_slots", "_g_merge");
  if (verbose)
    LOG("dm_pad_set_player=%p dm_pad_players=%p g_slots=%p g_merge=%p g_input_on=%p",
        (void *)game_set_player, (void *)game_players, (void *)game_slots,
        (void *)game_merge, (void *)game_input_off);
  return game_set_player && game_players && game_slots && game_merge && game_input_off;
}

// Les fonctions suivantes tournent sur la file principale, comme _pads_changed du jeu,
// pour ne jamais modifier g_slots en même temps que lui.
static void publish_players(void) {
  unsigned mask = 0;
  for (int i = 0; i < MAX_PLAYERS; i++)
    if (game_slots[i]) mask |= 1u << i;
  game_players(mask);
}

static void pad_attached(pad_t *pad) {
  dispatch_async(dispatch_get_main_queue(), ^{
    if (*game_merge) {
      atomic_store(&pad->player, 0);
      LOG("manette '%s' branchée : joueur 1 (DM_PAD_MERGE)", pad->name);
      return;
    }
    for (int i = 0; i < MAX_PLAYERS; i++) {
      if (game_slots[i]) continue;
      game_slots[i] = SLOT_MARK;
      atomic_store(&pad->player, i);
      publish_players();
      LOG("manette '%s' branchée : joueur %d", pad->name, i + 1);
      return;
    }
    LOG("manette '%s' branchée : tous les joueurs sont pris, ignorée", pad->name);
  });
}

static void pad_detached(pad_t *pad) {
  int player = atomic_exchange(&pad->player, -1);
  dispatch_async(dispatch_get_main_queue(), ^{
    if (player >= 0) {
      game_set_player((unsigned)player, 0, 0, 0, 0, 0);
      if (!*game_merge && game_slots[player] == SLOT_MARK) {
        game_slots[player] = 0;
        publish_players();
      }
      LOG("manette '%s' débranchée : joueur %d libéré", pad->name, player + 1);
    }
    free(pad);
  });
}

static void pad_report(pad_t *pad) {
  int player = atomic_load(&pad->player);
  if (player < 0) return;
  if (*game_input_off & 1) {   // fenêtre inactive : le jeu a relâché ses entrées
    game_set_player((unsigned)player, 0, 0, 0, 0, 0);
    return;
  }
  const uint8_t *r = pad->report;
  game_set_player((unsigned)player, decode_buttons(r),
                  clamp_axis(r[3], 0), clamp_axis(r[4], 1),
                  clamp_axis(r[5], 0), clamp_axis(r[6], 1));
}

#endif

static void on_report(void *ctx, IOReturn result, void *sender, IOHIDReportType type,
                      uint32_t id, uint8_t *report, CFIndex length) {
  (void)sender; (void)type; (void)id; (void)report;
  if (result == kIOReturnSuccess && length >= 7) pad_report(ctx);
}

static const char *known_name(IOHIDDeviceRef device) {
  int32_t vid = 0, pid = 0;
  CFNumberRef n = IOHIDDeviceGetProperty(device, CFSTR(kIOHIDVendorIDKey));
  if (n) CFNumberGetValue(n, kCFNumberSInt32Type, &vid);
  n = IOHIDDeviceGetProperty(device, CFSTR(kIOHIDProductIDKey));
  if (n) CFNumberGetValue(n, kCFNumberSInt32Type, &pid);
  for (size_t i = 0; i < sizeof known_pads / sizeof *known_pads; i++)
    if (known_pads[i].vid == (uint32_t)vid && known_pads[i].pid == (uint32_t)pid) return known_pads[i].name;
  return NULL;
}

static CFMutableDictionaryRef pads_by_device;

static void on_match(void *ctx, IOReturn result, void *sender, IOHIDDeviceRef device) {
  (void)ctx; (void)result; (void)sender;
  const char *name = known_name(device);
  if (!name || CFDictionaryContainsKey(pads_by_device, device)) return;
  pad_t *pad = calloc(1, sizeof *pad);
  pad->device = device;
  pad->name = name;
  atomic_init(&pad->player, -1);
  CFDictionarySetValue(pads_by_device, device, pad);
  IOHIDDeviceRegisterInputReportCallback(device, pad->report, sizeof pad->report, on_report, pad);
  pad_attached(pad);
}

static void on_remove(void *ctx, IOReturn result, void *sender, IOHIDDeviceRef device) {
  (void)ctx; (void)result; (void)sender;
  pad_t *pad = (pad_t *)CFDictionaryGetValue(pads_by_device, device);
  if (!pad) return;
  CFDictionaryRemoveValue(pads_by_device, device);
  pad_detached(pad);
}

static void *hid_thread(void *arg) {
  (void)arg;
  pads_by_device = CFDictionaryCreateMutable(NULL, 0, NULL, NULL);
  IOHIDManagerRef manager = IOHIDManagerCreate(kCFAllocatorDefault, kIOHIDOptionsTypeNone);
  CFMutableArrayRef matches = CFArrayCreateMutable(NULL, 0, &kCFTypeArrayCallBacks);
  for (size_t i = 0; i < sizeof known_pads / sizeof *known_pads; i++) {
    CFMutableDictionaryRef m = CFDictionaryCreateMutable(NULL, 0, &kCFTypeDictionaryKeyCallBacks,
                                                         &kCFTypeDictionaryValueCallBacks);
    CFNumberRef vid = CFNumberCreate(NULL, kCFNumberSInt32Type, &known_pads[i].vid);
    CFNumberRef pid = CFNumberCreate(NULL, kCFNumberSInt32Type, &known_pads[i].pid);
    CFDictionarySetValue(m, CFSTR(kIOHIDVendorIDKey), vid);
    CFDictionarySetValue(m, CFSTR(kIOHIDProductIDKey), pid);
    CFArrayAppendValue(matches, m);
    CFRelease(vid); CFRelease(pid); CFRelease(m);
  }
  IOHIDManagerSetDeviceMatchingMultiple(manager, matches);
  CFRelease(matches);
  IOHIDManagerRegisterDeviceMatchingCallback(manager, on_match, NULL);
  IOHIDManagerRegisterDeviceRemovalCallback(manager, on_remove, NULL);
  IOHIDManagerScheduleWithRunLoop(manager, CFRunLoopGetCurrent(), kCFRunLoopDefaultMode);
  IOReturn r = IOHIDManagerOpen(manager, kIOHIDOptionsTypeNone);
  if (r != kIOReturnSuccess) LOG("IOHIDManagerOpen a échoué (0x%x)", r);
  CFRunLoopRun();
  return NULL;
}

#ifdef PADBRIDGE_STANDALONE

int main(void) {
  printf("Appuie sur les boutons des manettes (Ctrl+C pour quitter).\n");
  hid_thread(NULL);
  return 0;
}

#else

__attribute__((constructor)) static void padbridge_init(void) {
  // nxnative hérite aussi de DYLD_INSERT_LIBRARIES : on n'agit que dans dmhost
  if (strcmp(getprogname(), "dmhost")) return;
  verbose = getenv("PADBRIDGE_VERBOSE") != NULL;
  if (!resolve_game()) {
    LOG("fonctions du jeu introuvables : version de dmhost non prise en charge, pont désactivé");
    return;
  }
  pthread_t t;
  pthread_create(&t, NULL, hid_thread, NULL);
  pthread_detach(t);
  LOG("prêt");
}

#endif
