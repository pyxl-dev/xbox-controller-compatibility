#!/bin/zsh
# Lance un portage nxnative avec le pont manettes, pour ce lancement seulement.
# Rien n'est modifié dans l'appli.
#   ./jouer.sh                          le seul portage installé dans /Applications ou ~/Applications
#   ./jouer.sh "/Applications/Jeu.app"  ce portage-là
# PADBRIDGE_VERBOSE=1 ./jouer.sh ajoute au journal du jeu les adresses trouvées.
set -e
DIR=${0:A:h}
if [[ -n $1 ]]; then
  APP=${1%/}
  shift
else
  ports=()
  for a in /Applications/*.app(N) "$HOME"/Applications/*.app(N); do
    [[ -f "$a/Contents/MacOS/nxnative" && -f "$a/Contents/MacOS/dmhost" ]] && ports+=("$a")
  done
  if (( ${#ports} != 1 )); then
    echo "${#ports} portages nxnative trouvés : indique lequel lancer, par exemple :" >&2
    printf '  ./jouer.sh "%s"\n' "${ports[@]}" >&2
    exit 1
  fi
  APP=${ports[1]}
fi
[[ -f "$APP/Contents/MacOS/nxnative" ]] || { echo "$APP n'est pas un portage nxnative." >&2; exit 1; }
[[ -f "$DIR/padbridge.dylib" ]] || make -C "$DIR" padbridge.dylib
DYLD_INSERT_LIBRARIES="$DIR/padbridge.dylib" exec "$APP/Contents/MacOS/nxnative" "$@"
