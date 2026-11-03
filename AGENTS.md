# Instructions for AI agents

You are an AI coding agent (Claude Code, Codex, Cursor...) and your user asked you to install or use **xbox-controller-compatibility**. This file tells you how. Keep the safety rules at the end: they matter more than the rest.

## What it does

macOS has no driver for third-party Xbox controllers such as the wired PDP Afterglow (USB `0e6f:02da`, Xbox GIP protocol). This repository has two independent parts:

| Part | What | Needs |
| --- | --- | --- |
| `extension/` | Brave extension (Manifest V3, "Afterglow pour Luna"). Opens the controller over WebUSB, sends the Xbox power-on sequence, and exposes it to Amazon Luna pages (`luna.amazon.*`) as a standard Xbox gamepad through `navigator.getGamepads()`, rumble included. | Brave, the controller plugged in over USB |
| `macos/` | Bridge for nxnative ports of Switch games (apps with `Contents/MacOS/nxnative` and `dmhost`, e.g. Super Mario 3D World). `padbridge.dylib` is injected into `dmhost` and feeds wired PowerA controllers (USB `20d6:a713`) to the game. | Apple Silicon, macOS 27+, `clang`, `make`, an nxnative port |

Only Safari and the Luna app are out of scope: they have no WebUSB.

## Install

Run, then read the output: every line starts with `✓`, `!` (optional piece missing) or `✗` (blocking).

```sh
curl -fsSL https://raw.githubusercontent.com/pyxl-dev/xbox-controller-compatibility/main/install.sh | sh
```

It downloads the repository to `~/.local/share/xbox-controller-compatibility` (or uses the current clone), checks Brave, `clang` and the CPU, and prints the folder to load. It touches nothing outside the home folder and does not install the bridge. Re-run it to update; `--uninstall` removes the folder.

- `✗ git is missing`: tell the user to run `xcode-select --install`. Do not install system tools without asking.
- `! Brave not found`: the extension needs Brave (https://brave.com/download). Ask before installing anything.
- **You cannot load the extension yourself.** Brave has no command line for it. Ask the user to do this once: open `brave://extensions`, turn on Developer mode, click "Load unpacked", choose `~/.local/share/xbox-controller-compatibility/extension` (or the `extension` folder of their clone).
- Nothing to verify from the terminal: the check is on Luna (see Use).

The nxnative bridge is a separate, optional step, only if the user has such a game and a PowerA controller (see Use).

## Use

Extension:

1. The user plugs the controller in, opens Luna in Brave (e.g. `https://luna.amazon.com`) and clicks the purple "Connecter la manette" button at the bottom right, picks the controller in Brave's window, then "Connexion". The controller rumbles and "Manette Afterglow connectée" shows. Brave remembers the permission afterwards.
2. To test without Luna: click the extension icon, it opens a test page with the same "Connecter la manette" button; pressed buttons light up.
3. Troubleshooting: only one program can open the controller at a time (close the test page when playing); reload Luna with Cmd+R; the page console shows `[Afterglow → Luna]` lines; `brave://settings/content/usbDevices` must let sites ask for USB access.

Bridge (run from `macos/`, quit the games first, tell the user it modifies the game app after backing it up):

```sh
./installer.sh                         # every nxnative port in /Applications and ~/Applications
./installer.sh "/Applications/Game.app"
./installer.sh --retirer [app...]      # restore the app exactly as it was
./jouer.sh ["/Applications/Game.app"] # one session with the bridge, nothing modified
make padbridge-test && ./padbridge-test  # print controller buttons outside a game
```

Backups live in `~/Library/Application Support/padbridge/sauvegarde/<bundle id>`. Messages from the bridge are `[padbridge]` lines in `~/Library/Logs/nxnative/<TITLE ID>.log`; `PADBRIDGE_VERBOSE=1` adds details.

## Safety rules

- `macos/installer.sh` rewrites `Info.plist`, re-signs the game app ad hoc and writes into `Contents/Frameworks`, usually under `/Applications`. Never run it without the user's go-ahead, never on an app that is running, and never delete the backup folder: `--retirer` needs it.
- Do not edit `extension/virtual-gamepad.js` or `manifest.json` to widen the matched sites beyond `luna.amazon.*`: the extension patches `navigator.getGamepads()` in the page, so it must stay scoped.
- Do not add network requests or storage to the extension. It has none today.
- Do not run `./install.sh --uninstall` while games still have the bridge: it refuses if backups exist, run `macos/installer.sh --retirer` first.
- No secrets are involved. If you find a key, token or personal path in a change, stop and tell the user.
