#!/bin/zsh
# Lance Super Mario 3D World + Bowser's Fury avec le pont manettes.
# Rien n'est modifié dans l'appli : la bibliothèque n'est chargée que pour ce lancement.
# PADBRIDGE_VERBOSE=1 ./jouer.sh affiche aussi les adresses trouvées dans le jeu.
set -e
DIR=${0:A:h}
APP="/Applications/Super Mario 3D World + Bowser's Fury.app"
[[ -f "$DIR/padbridge.dylib" ]] || make -C "$DIR" padbridge.dylib
DYLD_INSERT_LIBRARIES="$DIR/padbridge.dylib" exec "$APP/Contents/MacOS/nxnative" "$@"
