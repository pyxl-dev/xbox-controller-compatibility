#!/bin/zsh
# Installe le pont manettes dans les portages nxnative, pour qu'il se charge aussi au
# lancement depuis le Dock ou le Finder (variable LSEnvironment de Info.plist).
#   ./installer.sh                      installe ou met à jour le pont dans tous les portages
#   ./installer.sh "/Applications/Jeu.app"   ... seulement dans ce portage (plusieurs possibles)
#   ./installer.sh --retirer [appli…]   remet les applis exactement comme avant
# Un portage nxnative est une appli qui contient Contents/MacOS/nxnative et Contents/MacOS/dmhost.
# Le code du jeu n'est pas modifié : seuls Info.plist, la signature ad hoc du lanceur
# nxnative et le dossier Contents/Frameworks changent. Une sauvegarde est gardée avant.
set -e
DIR=${0:A:h}
BACKUPS="$HOME/Library/Application Support/padbridge/sauvegarde"
LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister

remove=0
if [[ $1 == --retirer ]]; then remove=1; shift; fi

is_port() { [[ -f "$1/Contents/MacOS/nxnative" && -f "$1/Contents/MacOS/dmhost" ]] }

# Vrai si un programme de l'appli tourne (chemin réel des exécutables, pas leurs arguments)
is_running() {
  local exe
  ps -axo comm= | while read -r exe; do
    [[ $exe == "$1/Contents/MacOS/"* ]] && return 0
  done
  return 1
}

apps=()
if (( $# )); then
  for a in "$@"; do
    a=${a%/}
    is_port "$a" || { echo "$a n'est pas un portage nxnative." >&2; exit 1; }
    apps+=("$a")
  done
else
  for a in /Applications/*.app(N) "$HOME"/Applications/*.app(N); do
    is_port "$a" && apps+=("$a")
  done
  (( ${#apps} )) || { echo "Aucun portage nxnative trouvé dans /Applications ni ~/Applications." >&2; exit 1; }
fi

# Ancienne sauvegarde unique (première version, Mario seul) : rangée sous l'identifiant de Mario
if [[ -f "$BACKUPS/Info.plist" ]]; then
  old_id=$(plutil -extract CFBundleIdentifier raw "$BACKUPS/Info.plist")
  mkdir -p "$BACKUPS/$old_id"
  mv "$BACKUPS/Info.plist" "$BACKUPS/nxnative" "$BACKUPS/CodeResources" "$BACKUPS/$old_id/"
fi

(( remove )) || make -C "$DIR" padbridge.dylib >/dev/null

failed=0
for APP in "${apps[@]}"; do
  name=${APP:t:r}
  PLIST="$APP/Contents/Info.plist"
  LIB="$APP/Contents/Frameworks/padbridge.dylib"
  BACKUP="$BACKUPS/$(plutil -extract CFBundleIdentifier raw "$PLIST")"

  if is_running "$APP"; then
    echo "$name : le jeu est ouvert, sauvegarde ta partie et quitte-le d'abord." >&2
    failed=1
    continue
  fi

  if (( remove )); then
    if [[ ! -d $BACKUP ]]; then
      echo "$name : pas de sauvegarde, rien à retirer."
      continue
    fi
    cp "$BACKUP/Info.plist" "$PLIST"
    cp "$BACKUP/nxnative" "$APP/Contents/MacOS/nxnative"
    cp "$BACKUP/CodeResources" "$APP/Contents/_CodeSignature/CodeResources"
    rm -f "$LIB"
    rmdir "$APP/Contents/Frameworks" 2>/dev/null || true
    "$LSREGISTER" -f "$APP"
    codesign --verify "$APP"
    rm -rf "$BACKUP"
    echo "$name : pont retiré, appli revenue à son état d'origine."
    continue
  fi

  # Sauvegarde unique, prise sur l'appli d'origine (pas sur une appli déjà modifiée)
  if [[ ! -d $BACKUP ]]; then
    mkdir -p "$BACKUP"
    cp "$PLIST" "$APP/Contents/MacOS/nxnative" "$APP/Contents/_CodeSignature/CodeResources" "$BACKUP/"
  fi

  mkdir -p "$APP/Contents/Frameworks"
  cp "$DIR/padbridge.dylib" "$LIB"
  codesign -s - -f "$LIB" 2>/dev/null

  plutil -remove LSEnvironment "$PLIST" 2>/dev/null || true
  plutil -insert LSEnvironment -dictionary "$PLIST"
  plutil -insert LSEnvironment.DYLD_INSERT_LIBRARIES -string "$LIB" "$PLIST"

  echo "$name : signature ad hoc de l'appli (quelques secondes)..."
  codesign -s - -f "$APP" 2>/dev/null
  codesign --verify "$APP"
  # LaunchServices garde Info.plist en cache : on lui fait relire l'appli
  "$LSREGISTER" -f "$APP"
  echo "$name : pont installé, lance le jeu normalement depuis le Dock ou le Finder."
done
exit $failed
