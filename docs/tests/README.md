# LuxDMX end-to-end test suite

Playwright tests that drive a **live LuxDMX device** end-to-end: they send real
Art-Net and sACN/E1.31 packets over the network and assert the device's REST API,
WebSocket, and web UI react correctly.

## Prerequisites

- A LuxDMX on the same LAN, reachable and powered.
- Node 21+ (uses the built-in global `WebSocket`).
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

## What's covered

| Spec | Feature (network → web UI) |
|---|---|
| `web-ui.spec.mjs` | Pages load; REST contract (`/info`, `/dmx`, `/senders`, `/log`, `/version`, `/labels`, `/rdm`); W5500 SPI-Ethernet config fields + `/config` pin card; home-page Update button → in-place install popup (newest version, no `/config` detour); OTA UI labelled "LuxDMX.org" |
| `artnet.spec.mjs` | Art-Net ArtDMX → DMX values, live grid, sender + FPS tracking; tight back-to-back burst keeps tracking (socket-drain regression). The per-loop latency win itself needs a logic analyzer on the DMX wire and isn't asserted here. |
| `sacn.spec.mjs` | sACN / E1.31 → DMX values, live grid, sender tracking |
| `conflict.spec.mjs` | Two simultaneous senders → conflict banner |
| `merge.spec.mjs` | Issue #10: per-output merge mode shape + UI; HTP per-channel max, sACN priority override, LTP persistence (opt-in) |
| `changelog.spec.mjs` | DMX changes appear in `/log.json` + the change-log card |
| `manual-blackout.spec.mjs` | Manual override + per-channel set + blackout (via the UI) |
| `labels.spec.mjs` | Channel labels round-trip + grid rendering |
| `multi-output.spec.mjs` | Issue #4: `outputs[2]` shape, migration, RDM binding, UI; splitter + pin-less-output regression (opt-in) |
| `ota-update.spec.mjs` | `/ota/status` shape; home-page Update button → install popup → progress dialog shows the real phase/percent and only reloads onto the live page once the device reports the new version (full flash→update→restore cycle is opt-in) |
| `signal-loss.spec.mjs` | Per-output signal-loss policy: `/info` loss field + `/config` selector; after the 2.5 s source timeout HOLD keeps the frame, BLACKOUT zeros it, STOP holds (not zero), over Art-Net + sACN; persistence across reboot (opt-in) |
| `rdm-trigger.spec.mjs` | Issue #64 RMT DMX + esp_dmx-free RDM: `/rdm.json` controller shape; the HTTP RDM trigger endpoints (`/rdm/discover`, `/rdm/setaddr`, `/rdm/identify`) — param validation returns 400, valid calls queue a bus action and return `{ok,op}` (opt-in). The RMT framing win and on-wire discovery/GET/SET are validated on the RP2350 rig, not here (see note). |
| `artnet-rdm.spec.mjs` | RDM over Art-Net (E1.20 over Art-Net 4): `/rdm.json` node fields (`artnetRdm`/`artPort`/`discovering`/`bqPolicy` + request counters); drives the device as an Art-Net RDM controller: ArtPoll → ArtPollReply (asserts RDM-capable + BackgroundQueue-supported advertisement), ArtTodRequest → ArtTodData (TOD matches `/rdm.json`), and (opt-in) ArtRdm GET DEVICE_INFO + SET DMX_START_ADDRESS with read-back, AtcFlush re-discovery, a check that a mid-stream flush doesn't collapse the transmit rate (`outfps`), and `ArtAddress` remote config (merge HTP/LTP/cancel applied live; BackgroundQueuePolicy set + reflected in `/rdm.json` and ArtPollReply). The full DMX-stays-40fps-under-RDM proof is on the RP2350 analyzer (see `../rdm.md`). |
| `rdm-tab.spec.mjs` | The dedicated RDM tab (`/rdm`): page serves the fixtures table + grouped sensor charts + per-sensor poll switches + the live discovery progress bar + the shared Status nav strip (full-width, view transitions); `/rdm.json` exposes the rich per-fixture fields (`mfg`/`modelName`/`label`/`cat`/`swVer`, per-sensor `lo`/`hi`/`rec`/`type`/`poll`), the `sensorPoll` flag, and the discovery-progress fields (`discStage`/`discFound`/`discCur`/`discSub`). Opt-in (drives the bus): discovery reads manufacturer/model/varied sensors, the progress fields advance through the scan, SET device label + SET personality round-trip over the WebSocket, the per-fixture switch (`rdm_sensorsel` `sensor:-1`) toggles a whole fixture's sensors, and live sensor polling moves the readings. Multi-line RDM: `/rdm.json` exposes `rdmLines` (the RDM-capable universes) + a per-fixture `uni`, the page has the Universe column + per-universe Discover buttons, and discovering one universe (`/rdm/discover?line=N`) leaves the other universes' fixtures in place. Needs a responder that answers the extra PIDs (the RP2350 sim does). |

## Notes

- sACN frames are sent **unicast** to the device's port 5568 (it binds
  `INADDR_ANY`), which avoids host multicast-routing quirks while still
  exercising the full E1.31 parse path.
- The signal-loss **STOP** mode is checked at the buffer level (`/dmx.json` shows
  the buffer is held, not zeroed, which proves it isn't BLACKOUT). Its defining
  behaviour — the DMX line actually stops clocking — is only observable on the
  wire, so it needs a logic analyzer on the TX pin and is out of e2e scope.
- Tests run serially (`workers: 1`) since they share one physical device, and
  network specs reset manual override so they don't interfere with each other.
- **RMT DMX + RDM on the wire (issue #64)** can't be exercised by Playwright: the
  whole point — DMX clocked out of the RMT peripheral so frames survive the RMII
  Ethernet DMA contention (0 framing errors under load), and E1.20 discovery /
  GET / SET timing inside the ~2 ms turnaround — is only observable on the bus.
  It's validated on the RP2350 rig (a PIO framing analyzer cross-checked against a
  hardware-UART ground truth, plus a 64-fixture RDM responder with a fuzz engine):
  clean 40.0 Hz / 0 framing errors on both taps, discovery + GET/SET round-trips,
  and **sensor polling** (GET SENSOR_DEFINITION / SENSOR_VALUE, where the
  responder exposes a drifting temperature sensor and the controller reads it
  back into `/rdm.json` `sensors[]`). Cross-checked on both the WT32-ETH01 (internal RMII)
  and the ESP32-S3 + W5500 wiring (see `docs/rig-wiring-*.md`).
  `rdm-trigger.spec.mjs` covers the REST surface that *is* web-observable.
- **DHCP hostname (option 12)** can't be exercised by this suite: the device
  advertising its hostname only has a visible effect on the *router's* DNS, which
  needs a real DHCP server, so it's out of e2e scope. It was verified by HIL
  against a Fritzbox: set a made-up hostname over the serial console, reboot, and
  confirm the router resolves it (`<name>.fritz.box` → device IP) with no mDNS
  involved. Checked on both WiFi STA and wired W5500 (each interface registers via
  its own DHCP lease). The hostname field itself round-trips through `/config` +
  `/info.json`, which `web-ui.spec.mjs` already covers.
