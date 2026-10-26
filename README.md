# Manette Afterglow sur Amazon Luna (macOS)

macOS ne reconnaît pas la manette filaire **PDP Afterglow pour Xbox Series X** (USB `0e6f:02da`) :
elle utilise le protocole Xbox « GIP », et le pilote intégré d'Apple ne gère que les manettes Microsoft.
Résultat : aucun jeu ni site ne la voit, et le réglage « Manettes de jeu » reste vide.

Le dossier [`extension/`](extension) contient une extension pour **Brave** qui contourne le problème
sans pilote système :

1. elle ouvre la manette directement en USB (WebUSB) et lui envoie la séquence d'allumage Xbox ;
2. elle lit les boutons, sticks et gâchettes ;
3. elle les présente à Luna comme une manette Xbox standard (avec vibrations).

Elle n'agit que sur les pages `luna.amazon.*`.

Testé sur macOS 27 (Apple Silicon) avec Brave : *Control* se joue sans problème sur Luna.

## Installation (une seule fois)

1. Ouvre Brave et va sur `brave://extensions`.
2. Active **Mode développeur** (en haut à droite).
3. Clique sur **Charger l'extension non empaquetée** et choisis le dossier
   `xbox-controller-compatibility/extension`.
4. Épingle l'extension « Afterglow pour Luna » dans la barre d'outils (icône puzzle) si tu veux
   accéder facilement à la page de test.

## Vérifier la manette (facultatif mais conseillé)

1. Clique sur l'icône de l'extension : une page de test s'ouvre.
2. Clique sur **Connecter la manette**, choisis « Afterglow Wired Controller for Xbox Series X »
   dans la fenêtre de Brave, puis **Connexion**.
3. La manette vibre brièvement. Appuie sur les boutons : ils s'allument à l'écran.

## Jouer sur Luna

1. Va sur Luna dans Brave (par ex. `https://luna.amazon.com`).
2. La première fois, clique sur le bouton violet **🎮 Connecter la manette** en bas à droite,
   choisis la manette, puis **Connexion**.
3. Un message « Manette Afterglow connectée » s'affiche et la manette vibre : c'est prêt.

Ensuite, Brave se souvient de l'autorisation : la manette se reconnecte toute seule à chaque
visite sur Luna, et aussi si tu la débranches puis la rebranches.

## En cas de problème

- **Aucune fenêtre de choix ne s'ouvre / « WebUSB est désactivé »** : vérifie
  `brave://settings/content/usbDevices` : l'option doit permettre aux sites de demander l'accès.
- **La manette n'apparaît pas dans la liste** : débranche-la et rebranche-la, puis recharge la page.
  Ferme aussi les autres onglets ou applis qui l'utiliseraient, puisqu'un seul programme peut l'ouvrir
  à la fois (la page de test et Luna en même temps, par exemple).
- **Luna ne réagit pas alors que la page de test fonctionne** : recharge la page Luna
  (`Cmd+R`). Ouvre la console (`Cmd+Option+J`) et cherche les lignes `[Afterglow → Luna]`.
- **Désinstaller** : `brave://extensions` → « Supprimer » sur l'extension. Rien d'autre n'est
  installé sur le Mac.

## Limites

- Fonctionne dans Brave (ou Chrome/Edge), **pas dans Safari** ni l'appli Luna, qui ne gèrent pas WebUSB.
- Les boutons « Partager » et le casque branché sur la manette ne sont pas gérés.

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `extension/gip-driver.js` | Pilote du protocole Xbox GIP au-dessus de WebUSB |
| `extension/virtual-gamepad.js` | Injecté dans Luna : expose la manette via `navigator.getGamepads()` |
| `extension/tester.html` / `tester.js` | Page de test de la manette |
| `extension/background.js` | Ouvre la page de test au clic sur l'icône |
| `macos/padbridge.c` | Pont PowerA → Super Mario 3D World (bibliothèque injectée et outil de test) |
| `macos/installer.sh` | Installe ou retire le pont dans l'appli du jeu |
| `macos/jouer.sh` | Lance le jeu avec le pont sans l'installer |

## Manettes PowerA sur Super Mario 3D World + Bowser's Fury (appli native)

Le dossier [`macos/`](macos) contient un pont pour le portage natif du jeu
(`/Applications/Super Mario 3D World + Bowser's Fury.app`, lanceur `nxnative` + moteur `dmhost`).
Le jeu ne lit que les manettes reconnues par GameController.framework (Xbox, Joy-Con, DualSense…).
Les manettes filaires **PowerA « NSW wired controller »** (USB `20d6:a713`) n'y apparaissent pas.

`padbridge.dylib` est chargée dans `dmhost` au lancement. Elle lit les PowerA en HID et les donne au
jeu par ses fonctions `dm_pad_set_player` / `dm_pad_players`, avec la disposition Switch (A reste A),
les sticks analogiques et un joueur par manette. Elle cohabite avec les manettes gérées par le jeu :
deux PowerA + Joy-Con + manette Xbox donnent 4 joueurs.

### Installation

```sh
cd macos
./installer.sh
```

Quitte le jeu avant. Le script compile le pont, le copie dans `Contents/Frameworks` de l'appli,
ajoute `DYLD_INSERT_LIBRARIES` dans `LSEnvironment` de son `Info.plist` et la re-signe en ad hoc
(comme à l'origine). Le jeu se lance ensuite normalement depuis le Dock ou le Finder. Une sauvegarde
des fichiers modifiés est gardée dans `~/Library/Application Support/padbridge/sauvegarde`.

- **Retirer le pont** : `./installer.sh --retirer` remet l'appli exactement comme avant.
- **Après une reconstruction de l'appli** (nouvelle version du jeu) : relance `./installer.sh`.
- **Sans installer** : `./jouer.sh` lance le jeu avec le pont pour une seule partie.
- **Tester les manettes hors jeu** : `make padbridge-test && ./padbridge-test` affiche chaque bouton.
- **Diagnostic** : les messages `[padbridge]` sont dans `~/Library/Logs/nxnative/010028600EBDA000.log`
  (le jeu y écrit sa sortie). `PADBRIDGE_VERBOSE=1 ./jouer.sh` y ajoute les adresses trouvées.

Si une version du jeu ne contient plus les fonctions attendues, le pont se désactive tout seul et le
jeu se lance sans lui.

### Joy-Con inversés (A agit comme B)

Le jeu lit les manettes GameController par position, à la manière Xbox. Avec des Joy-Con combinés
(Capture + Home 3 s), inverse A/B et X/Y dans **Réglages Système > Manettes de jeu**.

## Licence

[MIT](LICENSE). Le protocole GIP est implémenté d'après les pilotes Linux open source
[xpad](https://github.com/torvalds/linux/blob/master/drivers/input/joystick/xpad.c) et
[xone](https://github.com/medusalix/xone).
