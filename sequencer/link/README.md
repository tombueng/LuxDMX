# LuxDMX Link

A web page can't send Art-Net or sACN (browsers have no UDP). LuxDMX Link is a small program
that does it for the LuxDMX Sequencer: it runs on the computer the browser runs on, and the
sequencer plays any Art-Net or sACN node on the network through it. No popup, no click: the page
finds it by itself and reconnects when it's restarted. A LuxDMX box works this way too (it's an
Art-Net node like any other); without Link, the sequencer talks to LuxDMX boxes through their own
bridge page instead.

## Getting it

In the sequencer: `+`, **Art-Net / sACN from this computer**. If Link isn't running, the pill says
"not running" and **Get Link** offers the file for your computer (the others are under "Other
systems"). The files:

| System | File |
| --- | --- |
| Windows (Intel / AMD, ARM) | `luxdmx-link-windows-amd64.exe`, `luxdmx-link-windows-arm64.exe` |
| macOS (Apple chip, Intel) | `luxdmx-link-macos-arm64.zip`, `luxdmx-link-macos-amd64.zip` |
| Linux (PC, Raspberry Pi 4 / 5 with a 64-bit system) | `luxdmx-link-linux-amd64`, `luxdmx-link-linux-arm64` |

The Mac ones are zips because a browser saves a download without the "may run" bit, and a Mac
can't start a file without it. The zip keeps it; a double-click unpacks it (Safari does it by
itself).

## Installing: open it once

Open the downloaded file (double-click). It:

1. copies itself into your own programs folder (no admin rights, nothing for other users),
2. makes itself start when you log in,
3. starts that copy in the background and opens its page in the browser, then quits.

| | Where it goes | What starts it at login |
| --- | --- | --- |
| Windows | `%LOCALAPPDATA%\LuxDMX Link\luxdmx-link.exe` | `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, "LuxDMX Link" (it's also listed in Settings, Apps) |
| macOS | `~/Library/Application Support/LuxDMX Link/luxdmx-link` | `~/Library/LaunchAgents/org.luxdmx.link.plist` (macOS says "Background item added": that's this) |
| Linux | `~/.local/share/luxdmx-link/luxdmx-link` (or `$XDG_DATA_HOME`) | `~/.config/autostart/luxdmx-link.desktop` (KDE, GNOME, Xfce and the others read it) |

The sequencer goes live by itself a moment later. The download can go in the bin after that.
Opening it again while Link runs just shows the page. A newer download stops the running Link and
takes its place (an older one leaves a newer Link alone). The installed copy writes a short log,
`link.log`, next to itself.

## The first time: the warnings

Link isn't signed with an Apple or Microsoft certificate yet (that needs paid developer accounts),
so each system asks once whether you trust it. The source is all in this folder.

- **Windows**: Edge or Chrome may say the file "isn't commonly downloaded": choose Keep. When you
  open it, "Windows protected your PC": **More info**, then **Run anyway**. Windows may ask
  whether it may use the network: allow it on private networks (that's how nodes' answers to
  ArtPoll get in). Now and then a virus scanner flags unsigned Go programs; it's a false alarm,
  and the sha256 of every file is in `manifest.json` next to them.
- **macOS**: unzip, then **right-click LuxDMX Link, Open**, and Open again in the dialog. On
  macOS 15 and newer that dialog has no Open button: try once, then **System Settings, Privacy &
  Security, Open Anyway** (it asks for your password). A Terminal window shows what it did; close
  it. If macOS still refuses: `xattr -d com.apple.quarantine ~/Downloads/LuxDMX\ Link` in Terminal.
- **Linux**: make it executable (file manager: Properties, Permissions, "Allow executing file as
  program"; or `chmod +x luxdmx-link-linux-amd64`), then open it. Opened without a terminal, a
  problem shows as a desktop notification (where `notify-send` is there).

The installed copy doesn't ask again: it's a copy the system made itself, not a download.

**The browser asks too.** Using the app from the internet (GitHub Pages), Chrome asks once
whether the site may reach devices on your local network (Local Network Access): choose Allow.
Said no, the page can't reach Link even while it runs, and its pill says "blocked by the
browser" instead of "not running"; allow it later in the site settings (the icon left of the
address) and the page connects at once. A LuxDMX box through its own popup isn't affected.

## Its page

http://127.0.0.1:47920 says it's running, its version, which pages are connected and how many
frames a second each universe gets, the nodes that answered (name, address, universes), where it
is installed and whether it starts at login. It follows along by itself.

## Removing it

Any of these stops it, takes it out of what starts at login and deletes its folder:

- **Remove LuxDMX Link** on its page,
- Windows: Settings, Apps, LuxDMX Link, Uninstall,
- `luxdmx-link -uninstall` (any copy, from a terminal).

By hand: delete the folder and the login entry from the table above.

## Running it without installing

`luxdmx-link -run` runs it right there (for trying, or for development). Starting it with any of
the options below (other than `-install`, `-uninstall`, `-no-open`) runs it there too, as it
always did.

## Building

From the sequencer folder: `node scripts/build-link.mjs` builds all six into `public/link/` with a
`manifest.json` (file, system, chip, size, sha256, version), which is what the app offers.
`--only linux-amd64,macos-arm64` builds just those (the manifest keeps the others). Go 1.22 or
newer, no dependencies. The builds are reproducible (`-trimpath`, no build ids, a fixed date in
the zips): the same source gives the same sha256. Windows builds have no console window
(`-H=windowsgui`): it says things in the browser, or in a message box when something goes wrong.
The Apple chip build carries the ad-hoc signature Go's linker gives it (Apple silicon won't run a
program without one); that's not a Developer ID.

`public/link/` is not in git: run the script before `vite build` (a deploy has to as well). For a quick one:
`go build -o dist/luxdmx-link-linux-amd64 .` here.

Tests: `go test ./...` here (paths and login entries for all three systems, install, update,
uninstall, the status page, the Host and origin checks) and `e2e/link.spec.ts` in the sequencer.

## What it does

- Finds the nodes: an ArtPoll every 3 s to every network's broadcast address; the ones that answer
  (and the universes their outputs play) show in the sequencer.
- Art-Net: each universe goes unicast to the nodes that said they play it, or broadcast when none
  did. sACN (picked in the sequencer): multicast to the universe's group, universe = Art-Net + 1
  (as LuxDMX counts them). Or both.
- The page sends only what changed plus a 4 Hz heartbeat, so a still look costs very little.
- RDM (1.3.0 on), for the sequencer's rig check: Link is an RDM controller over Art-Net 4. A scan
  asks every node to search its outputs afresh (ArtTodControl), then for the lights it found
  (ArtTodRequest, ArtTodData), and reads each one through its node (ArtRdm): its maker, model and
  label, its modes with their channel counts, its address, its sensors, status messages and hours.
  It can set a light's address, mode and label and switch its identify on and off. Any Art-Net node
  that does RDM works (a LuxDMX box does). Its controller id is from the range kept for private use
  (7FF0:xxxxxxxx). sACN has no RDM, so a node reached only over sACN isn't scanned.

## Safety

- It listens on 127.0.0.1 only: nothing on the network can talk to it.
- It only answers when asked by its own address (127.0.0.1, localhost): a website on a name that
  points at 127.0.0.1 gets a 403 for everything.
- Only pages from these origins may use it: luxdmx.org, tombueng.github.io, and localhost /
  127.0.0.1 (any port, for a sequencer you run yourself). Another website you happen to have open
  gets a 403. More with `-allow http://192.168.1.10:8080`.
- Remove works only from its own page; stopping it (`/quit`, what an update uses) only from a
  program on this computer, never from a web page.

## Options

| Flag | Default | What |
| --- | --- | --- |
| (none) | | install it and start it (what a double-click does) |
| `-install` | | the same, from a script |
| `-no-open` | | with `-install`: don't open its page in the browser |
| `-uninstall` | | stop it and remove it |
| `-run` | | run here, without installing |
| `-port` | 47920 | where the page finds it (the sequencer expects 47920) |
| `-artnet-port` | 6454 | where nodes' ArtPollReply comes back (if another program has it, sending still works but finding nodes doesn't) |
| `-allow` | | more page origins, comma separated |
| `-to` | | all Art-Net to this one address (ip or ip:port) instead of finding nodes |
| `-sacn-to` | | sACN to this address instead of multicast |

## The protocol (for other pages)

WebSocket `ws://127.0.0.1:47920/ws`. Binary messages are DMX frames as the LuxDMX bridge takes them:
`'D', 1, universe low byte, universe high byte, priority (0 = 100), 0`, then 1 to 512 channel values.
Text messages are JSON: Link sends `{"type":"hello","version","nodes"}`, `{"type":"nodes","nodes"}`
when the list changes, and `{"type":"stats","fps":{"<universe>":n}}` once a second. The page may send
`{"type":"routes","routes":[{"uni":0,"proto":"artnet|sacn|both","to":"auto|broadcast|multicast|<ip>"}]}`
and `{"type":"poll"}`. Since 1.2.0 also `{"type":"page","id":"<any id, up to 64 characters>"}`:
connections that give the same id count as one page on Link's own page (the sequencer opens two,
one from the page and one from its DMX output thread). Older Links ignore it. Since 1.3.0, RDM:
`{"type":"rdm","id":<number>,"op":"list|scan|identify|address|mode|label","uid":"MMMM:DDDDDDDD","on","addr","mode","label"}`,
answered with `{"type":"rdm","id","ok","status","data"}`; `data` of `list` is shaped like a LuxDMX
box's `/rdm.json` (`busy`, `scanned`, `discStage`, `discFound`, `rdmLines`, `devices`). Older Links
don't answer (the sequencer says Link needs an update).

`GET /info.json` (CORS for the allowed origins) answers `{"app":"luxdmx-link","version","nodes","pages"}`.
