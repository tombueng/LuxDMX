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
| `artnet.spec.mjs` | Art-Net ArtDMX → DMX values, live grid, sender + FPS tracking |
| `sacn.spec.mjs` | sACN / E1.31 → DMX values, live grid, sender tracking |
| `conflict.spec.mjs` | Two simultaneous senders → conflict banner |
| `merge.spec.mjs` | Issue #10: per-output merge mode shape + UI; HTP per-channel max, sACN priority override, LTP persistence (opt-in) |
| `changelog.spec.mjs` | DMX changes appear in `/log.json` + the change-log card |
| `manual-blackout.spec.mjs` | Manual override + per-channel set + blackout (via the UI) |
| `labels.spec.mjs` | Channel labels round-trip + grid rendering |
| `multi-output.spec.mjs` | Issue #4: `outputs[2]` shape, migration, RDM binding, UI; splitter + pin-less-output regression (opt-in) |
| `ota-update.spec.mjs` | `/ota/status` shape; home-page Update button → install popup → progress dialog shows the real phase/percent and only reloads onto the live page once the device reports the new version (full flash→update→restore cycle is opt-in) |
| `signal-loss.spec.mjs` | Per-output signal-loss policy: `/info` loss field + `/config` selector; after the 2.5 s source timeout HOLD keeps the frame, BLACKOUT zeros it, STOP holds (not zero), over Art-Net + sACN; persistence across reboot (opt-in) |

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
- **DHCP hostname (option 12)** can't be exercised by this suite: the device
  advertising its hostname only has a visible effect on the *router's* DNS, which
  needs a real DHCP server, so it's out of e2e scope. It was verified by HIL
  against a Fritzbox: set a made-up hostname over the serial console, reboot, and
  confirm the router resolves it (`<name>.fritz.box` → device IP) with no mDNS
  involved. Checked on both WiFi STA and wired W5500 (each interface registers via
  its own DHCP lease). The hostname field itself round-trips through `/config` +
  `/info.json`, which `web-ui.spec.mjs` already covers.
