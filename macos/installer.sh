#!/bin/zsh
# Installe le pont manettes dans l'appli Mario, pour qu'il se charge aussi au lancement
# depuis le Dock ou le Finder (variable LSEnvironment de Info.plist).
#   ./installer.sh            installe ou met à jour le pont
#   ./installer.sh --retirer  remet l'appli exactement comme avant
# Le code du jeu n'est pas modifié : seuls Info.plist, la signature ad hoc du lanceur
# nxnative et le dossier Contents/Frameworks changent. Une sauvegarde est gardée avant.
set -e
DIR=${0:A:h}
APP="/Applications/Super Mario 3D World + Bowser's Fury.app"
LIB="$APP/Contents/Frameworks/padbridge.dylib"
BACKUP="$HOME/Library/Application Support/padbridge/sauvegarde"
LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister

if pgrep -x dmhost >/dev/null || pgrep -x nxnative >/dev/null; then
  echo "Mario est ouvert : sauvegarde ta partie et quitte le jeu d'abord." >&2
  exit 1
fi

if [[ $1 == --retirer ]]; then
  [[ -d $BACKUP ]] || { echo "Aucune sauvegarde dans $BACKUP : rien à retirer." >&2; exit 1; }
  cp "$BACKUP/Info.plist" "$APP/Contents/Info.plist"
  cp "$BACKUP/nxnative" "$APP/Contents/MacOS/nxnative"
  cp "$BACKUP/CodeResources" "$APP/Contents/_CodeSignature/CodeResources"
  rm -f "$LIB"
  rmdir "$APP/Contents/Frameworks" 2>/dev/null || true
  "$LSREGISTER" -f "$APP"
  codesign --verify "$APP"
  rm -rf "$BACKUP"
  echo "Pont retiré : l'appli est revenue à son état d'origine."
  exit 0
fi

make -C "$DIR" padbridge.dylib >/dev/null

# Sauvegarde unique, prise sur l'appli d'origine (pas sur une appli déjà modifiée)
if [[ ! -d $BACKUP ]]; then
  mkdir -p "$BACKUP"
  cp "$APP/Contents/Info.plist" "$APP/Contents/MacOS/nxnative" \
     "$APP/Contents/_CodeSignature/CodeResources" "$BACKUP/"
fi

mkdir -p "$APP/Contents/Frameworks"
cp "$DIR/padbridge.dylib" "$LIB"
codesign -s - -f "$LIB" 2>/dev/null

PLIST="$APP/Contents/Info.plist"
plutil -remove LSEnvironment "$PLIST" 2>/dev/null || true
plutil -insert LSEnvironment -dictionary "$PLIST"
plutil -insert LSEnvironment.DYLD_INSERT_LIBRARIES -string "$LIB" "$PLIST"

echo "Signature ad hoc de l'appli (quelques secondes)..."
codesign -s - -f "$APP" 2>/dev/null
codesign --verify "$APP"
# LaunchServices garde Info.plist en cache : on lui fait relire l'appli
"$LSREGISTER" -f "$APP"
echo "Pont installé : lance Mario normalement, depuis le Dock ou le Finder."
