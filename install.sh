#!/bin/sh
# xbox-controller-compatibility installer.
#
#   curl -fsSL https://raw.githubusercontent.com/pyxl-dev/xbox-controller-compatibility/main/install.sh | sh
#   ./install.sh               # from a clone: checks it and prints the extension folder
#   ./install.sh --uninstall
#
# Downloads the repository to ~/.local/share/xbox-controller-compatibility (or uses
# this clone) so the Brave extension has a stable folder to load, and checks the
# requirements. The extension itself is loaded by hand in brave://extensions (Brave
# has no command line for that). Re-run to update. Nothing outside your home folder
# is touched: the nxnative bridge in macos/ is a separate, explicit step.
set -eu

REPO="${XBOX_CONTROLLER_REPO:-https://github.com/pyxl-dev/xbox-controller-compatibility.git}"
DEST="${XBOX_CONTROLLER_HOME:-$HOME/.local/share/xbox-controller-compatibility}"
BACKUPS="$HOME/Library/Application Support/padbridge/sauvegarde"

if [ -t 1 ]; then B=$(printf '\033[1m'); G=$(printf '\033[32m'); Y=$(printf '\033[33m'); R=$(printf '\033[31m'); N=$(printf '\033[0m'); else B= G= Y= R= N=; fi
ok()   { printf '%s✓%s %s\n' "$G" "$N" "$1"; }
warn() { printf '%s!%s %s\n' "$Y" "$N" "$1"; }
die()  { printf '%s✗%s %s\n' "$R" "$N" "$1" >&2; exit 1; }

if [ "${1:-}" = "--uninstall" ]; then
  if [ -d "$BACKUPS" ] && [ -n "$(ls -A "$BACKUPS" 2>/dev/null)" ]; then
    warn "the nxnative bridge is still installed in some games: run  $DEST/macos/installer.sh --retirer  first, then re-run this."
    exit 1
  fi
  if [ -d "$DEST/.git" ]; then rm -rf "$DEST"; ok "removed $DEST"
  else ok "nothing to remove in $DEST"; fi
  echo "Left in place: the extension. Remove it in Brave: brave://extensions, then Remove on \"Afterglow pour Luna\"."
  exit 0
fi

printf '%sxbox-controller-compatibility%s installer\n\n' "$B" "$N"
[ "$(uname -s)" = "Darwin" ] || die "macOS only."

# 1. Code: this clone, or a managed one in ~/.local/share.
HERE=$(cd "$(dirname "$0")" 2>/dev/null && pwd || true)
if [ -n "$HERE" ] && [ -f "$HERE/extension/manifest.json" ] && [ -f "$HERE/macos/installer.sh" ]; then
  DEST="$HERE"
  ok "using this clone: $DEST"
elif [ -d "$DEST/.git" ]; then
  git -C "$DEST" pull --ff-only -q || die "could not update $DEST (local changes?)"
  ok "updated $DEST"
else
  command -v git >/dev/null || die "git is missing: run  xcode-select --install"
  mkdir -p "$(dirname "$DEST")"
  git clone -q --depth 1 "$REPO" "$DEST" || die "could not download $REPO"
  ok "downloaded to $DEST"
fi
[ -f "$DEST/extension/manifest.json" ] || die "extension/manifest.json not found in $DEST"

# 2. Requirements.
if [ -d "/Applications/Brave Browser.app" ] || [ -d "$HOME/Applications/Brave Browser.app" ]; then ok "Brave found"
else warn "Brave not found: the extension needs it (https://brave.com/download). Chrome and Edge also have WebUSB but were not tested."; fi
if command -v clang >/dev/null; then ok "clang found (only needed for the nxnative bridge)"
else warn "clang missing: only needed for the nxnative bridge. Install it with  xcode-select --install"; fi
[ "$(uname -m)" = "arm64" ] || warn "this is not an Apple Silicon Mac: the nxnative bridge is built for arm64 only. The extension is not affected."

# 3. What is left to do by hand.
printf '\n%sDone.%s Load the extension in Brave, once:\n' "$B" "$N"
echo "  1. Open brave://extensions and turn on Developer mode (top right)."
echo "  2. Click \"Load unpacked\" and choose this folder:"
printf '       %s%s/extension%s\n' "$B" "$DEST" "$N"
echo "  3. Plug in the controller, open https://luna.amazon.com and click \"Connecter la manette\"."
echo "Update later: re-run this installer, then click the reload icon of the extension in brave://extensions."
echo "Games ported with nxnative and PowerA controllers: see macos/ in the README."
