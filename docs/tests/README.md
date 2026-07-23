# LuxDMX end-to-end test suite

Playwright tests that drive a **live LuxDMX device** end-to-end: they send real
Art-Net and sACN/E1.31 packets over the network and assert the device's REST API,
WebSocket, and web UI react correctly.

## Prerequisites

- A LuxDMX on the same LAN, reachable and powered.
- Node 21+ (uses the built-in global `WebSocket`).
- *Optional*, for the two on-the-wire specs: an [RP2350 analyzer](https://github.com/tombueng/dmx-analyzer)
  on the gateway's DMX line (see [Measuring the wire](#measuring-the-wire)).
- Dependencies + the Chromium browser:

```bash
cd docs
npm install
npx playwright install chromium
```

## Run

```bash
cd docs
npm test                 # all default (non-destructive) tests
npm run test:headed      # watch the browser
npm run report           # open the last HTML report
```

### Targeting the device

Resolution order: `LUXDMX_URL` → mDNS lookup of `LUXDMX_HOST` → fallback IP
(`192.168.178.197`).

```bash
LUXDMX_HOST=dmx-gateway.local npm test
LUXDMX_URL=http://192.168.1.50 npm test
```

### Device-mutating tests (opt-in)

A few tests change config and reboot the device (multi-output round-trip, the
boot-loop regression). They are skipped unless you opt in:

```bash
LUXDMX_WRITE=1 npm test
```

They always restore the original configuration afterwards.

One more device-mutating test lives outside the Playwright runner, because it drives raw
sockets rather than a browser:

```bash
LUXDMX_WRITE=1 LUXDMX_URL=http://<ip> node docs/tests/ota-upload-truncated.mjs
```

It proves a firmware upload that stops mid-stream is rejected instead of being reported as
a success (see the header comment for the failure it guards). It writes the device's OTA
slot but never completes a valid image, so the running firmware is never replaced.

### Measuring the wire

`dmx-wire.spec.mjs` and `rdm-wire.spec.mjs` check what actually came out of the XLR, using an
[RP2350 analyzer](https://github.com/tombueng/dmx-analyzer) sitting on the DMX line as a second
pair of eyes (wiring: `docs/rig-wiring-esp32s3-v6.md`). Everything else in this suite asks the
gateway how it thinks it is doing; these two ask the bus.

```bash
LUXDMX_ANALYZER=192.168.178.105 LUXDMX_WRITE=1 npm test
```

- The analyzer has no mDNS, so point `LUXDMX_ANALYZER` (or `LUXDMX_ANALYZER_URL`) at its IP.
  Both specs **skip themselves** when nothing answers, so a run without the rig stays green.
- They work out which output they are watching by driving each enabled output with a marker
  pattern and seeing which one appears on the line, so re-wiring the bench between workstreams
  does not silently test an output nobody is listening to.
- The analyzer's `/api/dmx` must be a build with the seqlocked publish path (it reports a `tr`
  counter). An unlocked build serialises the frame buffer while the next frame overwrites it and
  reports ~2.9% torn frames that are the instrument, not the gateway — which is exactly the
  failure the torn-frame test is looking for.

### Standalone config-UI tests (no device, no Playwright runner)

These behaviour tests drive the real `src/pages/config.html` in a headless browser against a stub
device — run them directly with `node`, they self-report and exit non-zero on failure:

```bash
node docs/tests/v6-locks.mjs      # board detected as luxdmx_v6 -> copper pins locked + mirrored,
                                  #   the J4 display-header pins stay editable, headers listed
node docs/tests/v6-template.mjs   # generic S3 board -> picking the "LuxDMX v6" template fills the
                                  #   fixed pin map: W5500 SPI + LED + display + DMX pins get set,
                                  #   panel brightness is pushed to /led/bright?...&save=1, and the
                                  #   v6's copper pins lock behind the pick. This is the flow a v6
                                  #   owner uses now that there is no dedicated v6 build.
node docs/tests/board-persist.mjs # the picked board STICKS: /info.json boardSel beats the detected
                                  #   (compile-time) board id, the locks follow the restored pick,
                                  #   the selector submits as board=..., "custom" stays custom, a
                                  #   device with no saved pick still falls back to detection, and
                                  #   an unknown saved board degrades to detection instead of wedging
node docs/tests/dm9051-roundtrip.mjs  # a DM9051 box survives a /config save: the wired selector
                                  #   reads ethSpiPhy from /info.json and posts it back unchanged.
                                  #   Guards the bug where /info.json didn't publish the field, so
                                  #   any save silently rewrote a DM9051 device to W5500.
```

## What's covered

| Spec | Feature (network → web UI) |
|---|---|
| `web-ui.spec.mjs` | Pages load; REST contract (`/info`, `/dmx`, `/senders`, `/log`, `/version`, `/labels`, `/rdm`); W5500 SPI-Ethernet config fields + `/config` pin card; the W5500 role pins are not flagged "reserved" against their own role (Save stays enabled) and a fixed-pin board offers an Advanced unlock while the J4 display pins stay editable; the picker lists the J4 + J6 header pinouts and tags each header pad with its pin; **luxdmx_v6** shows J4/J6 with identical power pins (+3V3, GND) and no 5V anywhere on J6, IO35 on pin 3, UART0 on 7/8 and pin 9 a 2nd GND; the Join-WiFi link-loss fallback reveals the WiFi credentials on a wired box (AP fallback shows the AP password instead); home-page Update button → in-place install popup (newest version, no `/config` detour); OTA UI labelled "LuxDMX.org"; `/logo.webp` served as a small WebP image (replaces the ~117 KB PNG); the `/config` sections all start folded (summary in every header, unfold from the header, state remembered per browser, fields still submitted while folded, header switches keep working, Collapse/Expand all). Any test that drives a field on `/config` must unfold first — use `openConfig(page)` / `expandAll(page)` from [`lib/ui.mjs`](lib/ui.mjs) instead of a bare `page.goto('/config')` |
| `ota-url.spec.mjs` | Install firmware from a URL (`POST /ota/url`): a URL with no scheme (or `ftp://`, or empty) is refused with 400 and does **not** reboot the device, `GET` schedules nothing, and the Firmware Update card's URL form only enables its button for a real `http(s)://` URL. Opt-in: serves this repo's `firmware.bin` from a throwaway local HTTP server, points the device at it, and asserts the device really goes away, really fetches the image, comes back, and keeps hostname / universe / version. This is the path that works when a push upload can't: the device reboots and downloads with a pristine heap. |
| `reboot.spec.mjs` | Remote restart: `GET /reboot` must **not** restart anything (POST-only, so a prefetch or a crawler can't black out a live rig), the Device section offers a Restart button that is a plain button and not a form submit, and clicking it asks first with Cancel doing nothing. Opt-in: `POST /reboot` really does restart (the device is checked to actually go away, not just to answer), comes back within a minute, uptime restarts from zero, and hostname / universe / interface / WiFi SSID / LED config all survive — `/reboot` is not `/reset`. |
| `artnet.spec.mjs` | Art-Net ArtDMX → DMX values, live grid, sender + FPS tracking; tight back-to-back burst keeps tracking (socket-drain regression). The per-loop latency win itself needs a logic analyzer on the DMX wire and isn't asserted here. |
| `sacn.spec.mjs` | sACN / E1.31 → DMX values, live grid, sender tracking |
| `conflict.spec.mjs` | Two simultaneous senders → conflict banner |
| `merge.spec.mjs` | Issue #10: per-output merge mode shape + UI; HTP per-channel max, sACN priority override, LTP persistence (opt-in) |
| `changelog.spec.mjs` | DMX changes appear in `/log.json` + the change-log card |
| `manual-blackout.spec.mjs` | Manual override + per-channel set + blackout (via the UI) |
| `labels.spec.mjs` | Channel labels round-trip + grid rendering |
| `multi-output.spec.mjs` | Issue #4: `outputs[2]` shape, migration, RDM binding, UI; splitter + pin-less-output regression (opt-in) |
| `ota-update.spec.mjs` | `/ota/status` shape; home-page Update button → install popup → progress dialog shows the real phase/percent and only reloads onto the live page once the device reports the new version (full flash→update→restore cycle is opt-in) |
| `output-rate.spec.mjs` | Per-output DMX transmit rate + style (issue #93): `/info.json` carries `rate`/`style`/`styleSrc` per output; `/config` renders both selectors including the 33.3 fps entry and the provenance badge; ArtPollReply `RefreshRate` tracks the configured rate and `GoodOutputB` bit6 the configured style; the navbar renders one C/D letter per output with a dot marking a style a controller pushed over Art-Net, and spells it out in the tooltip. Behavioural (opt-in): picking 33.3 fps really moves the transmit rate off 40, Delta makes the output follow a deliberately slow source instead of free-running, and a silent source in Delta falls back to the configured rate so the line never stops. The duplicate-frame share, and the proof that the rate arrives on the *wire* rather than merely being scheduled, are in `dmx-wire.spec.mjs`. |
| `save-live.spec.mjs` | Saving `/config` only restarts when something that needs it changed: the save button reads `Save` (not `Save & Restart`); a live-only change (output B merge mode) applies with no modal, sticks, and uptime does not go backwards; a pin/driver-bound change (hostname) pops the modal, names the setting that forced the restart, and the device really does restart. Mutating parts opt-in via `LUXDMX_WRITE=1`, original hostname/merge restored. |
| *(bench only, not Playwright)* `tear_test.py` | Proves the DMX output frame is never read while it is being written. Fills all 512 channels with one value, so a torn frame shows as two values with a split point, and sweeps the input rate. A/B against the pre-fix firmware: 8.81% torn at 44 fps in before the seqlock, 3.19% after. That residual was suspected to be the analyzer's own unlocked read, and it was: with the analyzer's `/api/dmx` publish path seqlocked too, 1865 consecutive sampled frames came back clean. `dmx-wire.spec.mjs` now covers the same ground from the runner. |
| `dmx-wire.spec.mjs` | **What the gateway actually transmits**, measured by the RP2350 analyzer instead of asked of the device (needs the rig, skips without it). Always: the line carries a well-formed frame (null start code, 512 slots, break ≥ 88 µs); Art-Net *and* sACN slot values arrive on the wire unchanged, first, middle and last slot; a 6 s stream produces 0 framing errors on the PIO tap (and on the hardware-UART ground truth where that second tap is wired); and no torn frames (issue #106) — uniform-value frames in, so a frame carrying two values is one the gateway tore, cross-checked against the device's own `tornSkips` counter and the analyzer's `tr` counter so a clean result can't come from a degraded instrument. Opt-in (`LUXDMX_WRITE=1`, config restored): the configured rate is the rate **on the wire** at 40 / 33.3 / 25 fps — the independent half of `output-rate.spec.mjs`, which can only count what the device scheduled; Delta really tracks a 25 fps source down; and signal-loss **STOP actually stops the clock** while HOLD keeps clocking the held frame and BLACKOUT keeps clocking zeros. |
| `rdm-wire.spec.mjs` | **RDM checked from the far end of the bus**: the RP2350 responder simulator is the other side of every transaction, so it can confirm what the controller only claims. Always: the simulator is on the bus, and every fixture in the gateway's TOD exists on the bus at the address the gateway reports (no phantom devices). Opt-in (`LUXDMX_WRITE=1`, restores what it changes): a sweep discovers every simulated fixture up to the device cap and the decoded packet log shows real E1.20 traffic — a fixture answering a DISC_UNIQUE_BRANCH inside the turnaround, one DISC_MUTE per discovered fixture, DEVICE_INFO GETs (the log is drained *during* the sweep, since its 256-event ring laps in ~2 s at ~75 requests/s); SET DMX_START_ADDRESS moves the fixture inside the responder, not just in the controller's table; IDENTIFY switches on and off in the fixture; and DMX keeps clocking through a full sweep and recovers afterwards. |
| `signal-loss.spec.mjs` | Per-output signal-loss policy: `/info` loss field + `/config` selector; after the 4 s source timeout HOLD keeps the frame, BLACKOUT zeros it, STOP holds (not zero), over Art-Net + sACN; persistence across reboot (opt-in). That STOP really stops the line is asserted on the wire in `dmx-wire.spec.mjs`. |
| `rdm-trigger.spec.mjs` | Issue #64 RMT DMX + esp_dmx-free RDM: `/rdm.json` controller shape; the HTTP RDM trigger endpoints (`/rdm/discover`, `/rdm/setaddr`, `/rdm/identify`) — param validation returns 400, valid calls queue a bus action and return `{ok,op}` (opt-in). The RMT framing win and on-wire discovery/GET/SET are asserted in `dmx-wire.spec.mjs` + `rdm-wire.spec.mjs` when the analyzer is on the bench. |
| `artnet-rdm.spec.mjs` | RDM over Art-Net (E1.20 over Art-Net 4): `/rdm.json` node fields (`artnetRdm`/`artPort`/`discovering`/`bqPolicy` + request counters); drives the device as an Art-Net RDM controller: ArtPoll → ArtPollReply (asserts RDM-capable + BackgroundQueue-supported advertisement), ArtTodRequest → ArtTodData (TOD matches `/rdm.json`), and (opt-in) ArtRdm GET DEVICE_INFO + SET DMX_START_ADDRESS with read-back, AtcFlush re-discovery, a check that a mid-stream flush doesn't collapse the transmit rate (`outfps`), and `ArtAddress` remote config (merge HTP/LTP/cancel applied live; BackgroundQueuePolicy set + reflected in `/rdm.json` and ArtPollReply). Also pins the ArtPollReply timing advertisement honest (issue #93): `RefreshRate` matches the measured `outfps` and stays ≤ 44 Hz, `GoodOutputB` bit6 reports the continuous (free-running) output style, and `Status3` bits7-6 mirror the port’s signal-loss policy. The DMX-keeps-clocking-under-RDM proof is in `rdm-wire.spec.mjs`, measured on the wire. |
| `artnet-ipprog.spec.mjs` | Art-Net remote IP programming (issue #110): `ArtIpProg` (0xf800) → `ArtIpProgReply` (0xf900). Read-only: `ArtPollReply` `Status2` sets the web-config bit (bit0) and reports the **real** DHCP/static state in bit1 (regression for the old hard-coded `0x0e`, which lied about DHCP and left web-config clear); and, with the feature off (the default), an `ArtIpProg` gets **no reply at all** (the spec's opt-out). Opt-in (`LUXDMX_WRITE=1`, and `ipprog` on): an enquiry (Command bit7 clear) returns a well-formed 34-byte reply carrying the current IP / mask / gateway and changes nothing; programming a static IP (the device's own address, so it stays reachable — the change persists for the next boot rather than renumbering the live interface) is stored, reads back via a fresh enquiry, flips the reply's DHCP bit and `ArtPollReply` `Status2` bit1 to static, and the DHCP command switches it back. Restores config after. The actually-reboot-onto-a-new-address case is left to the rig with the Pi witness. |
| `rdm-tab.spec.mjs` | The dedicated RDM tab (`/rdm`): page serves the fixtures table + grouped sensor charts + per-sensor poll switches + the live discovery progress bar + the shared Status nav strip (full-width, view transitions); `/rdm.json` exposes the rich per-fixture fields (`mfg`/`modelName`/`label`/`cat`/`swVer`, per-sensor `lo`/`hi`/`rec`/`type`/`poll`), the `sensorPoll` flag, and the discovery-progress fields (`discStage`/`discFound`/`discCur`/`discSub`). Opt-in (drives the bus): discovery reads manufacturer/model/varied sensors, the progress fields advance through the scan, SET device label + SET personality round-trip over the WebSocket, the per-fixture switch (`rdm_sensorsel` `sensor:-1`) toggles a whole fixture's sensors, and live sensor polling moves the readings. Multi-line RDM: `/rdm.json` exposes `rdmLines` (the RDM-capable universes) + a per-fixture `uni`, the page has the Universe column + per-universe Discover buttons, and discovering one universe (`/rdm/discover?line=N`) leaves the other universes' fixtures in place. Needs a responder that answers the extra PIDs (the RP2350 sim does). |
| `led-activity.spec.mjs` | Status LED — one language on the single WS2812/GPIO LED and the 5-LED panel (`ledType 3`): green = up (slow 2 s blink = DMX in), blue = RDM/identify, orange = Ethernet-on-WiFi-fallback, red = no network, Knight-Rider boot. `/info.json` exposes the panel config (`ledType`/`ledR..W`), the per-colour PWM brightness (`ledBr*`), `chip`, `rdmMax`, and `ethFallback` (the orange-state flag — must be **false** on a reachable device); the RDM device cap auto-sizes to the chip and must be **64** on an ESP32-S3 / **16** on the classic ESP32 — a regression guard, since the old free-RAM heuristic shipped the S3 at 16 (found 16 instead of 64 fixtures); the RDM tx/rx counters that light the **blue** LED advance on discovery (opt-in). `/led/bright` round-trips: read the current brightness + calibration flag (always), and (opt-in) set a colour live + toggle the all-on calibration mode, restoring after. The actual LED photons, the Knight-Rider boot sweep, and the live no-wired-link→WiFi fallback (orange) are bench-verified with a camera / logic analyser / a link pull on real hardware, out of Playwright scope, like the on-wire DMX/RDM timing. |
| `setup.spec.mjs` | Issue #45 first-run setup portal: drives the real `setup.html` (landing shows both paths on-brand; access-point path posts `mode=ap` + AP password; join path picks a scanned SSID / manual entry and posts `mode=sta` + ssid + password). Runs against the local UI sim, not a live device (during first-run setup the device has no reachable network) |
| `config-roundtrip.spec.mjs` | Every `/config` web-form option survives the schema-driven POST → reboot → `/info.json` read-back, including the issue #24 on-unit controls fields (encoder pins/steps/reverse, the four button pins + actions, active-high, menu top universe). A non-destructive check also asserts the controls surface is present in `/info.json` with the right shape/types. Round-trip is opt-in (reboots the device twice). The physical encoder/button interaction itself needs a knob wired to a board and is bench-verified, not automatable here. |

## Notes

- sACN frames are sent **unicast** to the device's port 5568 (it binds
  `INADDR_ANY`), which avoids host multicast-routing quirks while still
  exercising the full E1.31 parse path.
- The signal-loss **STOP** mode is checked at the buffer level in
  `signal-loss.spec.mjs` (`/dmx.json` shows the buffer is held, not zeroed, which
  proves it isn't BLACKOUT). Its defining behaviour — the DMX line actually stops
  clocking — is only observable on the wire, and `dmx-wire.spec.mjs` now asserts it
  there when the RP2350 analyzer is on the bench.
- Timing DMX *while RDM runs* has to use the analyzer's `anFrames` counter, not the
  `/api/dmx` sequence number: the published frame view is fed from the RDM decode
  path and stands completely still during a discovery sweep (measured: 40/s idle,
  0/s during a sweep, while `anFrames` carried on at ~35/s). The ~12% dip is the
  rent RDM pays for sharing one half-duplex pair, not a scheduling bug.
- Tests run serially (`workers: 1`) since they share one physical device, and
  network specs reset manual override so they don't interfere with each other.
- **RMT DMX + RDM on the wire (issue #64)** used to be entirely out of Playwright's
  reach. Most of it is now in `dmx-wire.spec.mjs` + `rdm-wire.spec.mjs`, which drive
  the analyzer from the runner. What stays manual is the part that needs the fuzz
  engine and deliberate mis-timing (late turnarounds, corrupt checksums, flaky
  mutes) rather than a pass/fail on a healthy bus.
  It's validated on the RP2350 rig (a PIO framing analyzer cross-checked against a
  hardware-UART ground truth, plus a 64-fixture RDM responder with a fuzz engine):
  clean 40.0 Hz / 0 framing errors on both taps, discovery + GET/SET round-trips,
  and **sensor polling** (GET SENSOR_DEFINITION / SENSOR_VALUE, where the
  responder exposes a drifting temperature sensor and the controller reads it
  back into `/rdm.json` `sensors[]`). Cross-checked on both the WT32-ETH01 (internal RMII)
  and the ESP32-S3 + W5500 wiring (see `docs/rig-wiring-*.md`).
  `rdm-trigger.spec.mjs` covers the REST surface that *is* web-observable.
- **First-run setup portal (`setup.spec.mjs`)** is the one spec that does *not* drive a
  live device: while the portal is up the device is its own open `LuxDMX-setup` AP with a
  captive DNS and no route to the test host, so the spec boots the local UI sim
  (`sim/server.js`, gitignored) on a throwaway port and drives the real `setup.html`
  through both paths. The on-the-wire behaviour (AP actually comes up, captive-portal
  redirect, the chosen mode/creds persist and the device reboots into them) is verified on
  the HIL rig with the Pi witness joining `LuxDMX-setup` and walking the page. Also verified
  on the rig: the setup-done page points STA at `http://<hostname>.local` and AP at
  `192.168.4.1` (with the reachability-probe auto-redirect), and that "Reset WiFi" reliably
  reopens the portal — the one-time WiFi-creds migration must not re-recover the old network
  from the ESP32 WiFi NVS after a reset.
- **DHCP hostname (option 12)** can't be exercised by this suite: the device
  advertising its hostname only has a visible effect on the *router's* DNS, which
  needs a real DHCP server, so it's out of e2e scope. It was verified by HIL
  against a Fritzbox: set a made-up hostname over the serial console, reboot, and
  confirm the router resolves it (`<name>.fritz.box` → device IP) with no mDNS
  involved. Checked on both WiFi STA and wired W5500 (each interface registers via
  its own DHCP lease). The hostname field itself round-trips through `/config` +
  `/info.json`, which `web-ui.spec.mjs` already covers.
