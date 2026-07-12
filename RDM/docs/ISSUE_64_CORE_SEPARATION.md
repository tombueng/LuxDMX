# Issue #64 — WT32-ETH01 DMX framing errors: root cause + fix (measured)

GitHub: [tombueng/LuxDMX#64](https://github.com/tombueng/LuxDMX/issues/64) — "WT32-ETH01 DMX framing
errors with Swisson tester", reported by KM-LED.

> ## ⚠️ CORRECTION — this document's "verified fix" claim does NOT hold (2026-07-07, later)
> The framing-error numbers below were produced by a PIO analyzer whose framing detection is not
> reliable. A hardened (structural) rebuild of the same analyzer reports **0 framing errors on the
> BASELINE** as well — contradicting the "13 → 1" result. Both detector designs have a failure mode
> (gap-based → false positives under FIFO-drain bursts, `rxStall` confirmed; position-based → false
> negatives at the frame boundary, which is exactly where a real error would land). Physically, an
> ESP32 hardware UART can't corrupt a byte mid-send from CPU contention — so KM-LED's "framing errors"
> are most likely **break/MAB / frame-timing** violations, which neither PIO analyzer measures well.
> **The core-0 RMII fix is UNPROVEN.** It's kept as a low-risk architectural cleanup (it mirrors the
> W5500 path), not as a validated fix. Re-investigation is underway with a hardware-UART ground-truth
> framing reference and a precise break/MAB timing analyzer. Treat §2/§4a numbers below as unreliable.

Bench-reproduced, root-caused, fixed, and verified on 2026-07-07 using the RP2350 sim as a DMX
framing-error analyzer. TL;DR: the WT32's RMII Ethernet was brought up on the **DMX core**, so the
EMAC RX interrupt preempted the DMX transmit under network load. Moving the RMII bring-up to a
**core-0 task** (like the W5500 path already does) cut framing errors ~13× (4.4/min → 0.3/min).

---

## 1. The report

KM-LED runs LuxDMX on a **WT32-ETH01** (classic ESP32 + LAN8720 wired Ethernet). One output on GPIO4,
~40 Hz. The Swisson XMT-120 shows "DMX Signal OK, 512 channels" but counts **framing errors**:

| Setup | Framing errors |
|---|---|
| Wired Ethernet (LAN8720/RMII) | 12 in 3 min, 48 in 30 min (~4/min) |
| WiFi client/STA | ~25 during a test |
| **WiFi AP, web panel only (no Art-Net)** | **0 in ~22 min** |

Happens with FreeStyler, QLC+, and even with no Art-Net at all (web-panel control). Errors scale with
network load; the web UI never crashes.

## 2. Bench reproduction (RP2350 DMX framing analyzer)

The RP2350 sim now doubles as a **DMX framing-error analyzer** (see §5). Tap the WT32's DMX UART pin
straight into the analyzer: **WT32 GPIO4 → RP GP0**, **WT32 GND → RP GND**. That measures the firmware's
own framing with no RS485 layer in the path.

WT32-ETH01 on **wired Ethernet**, baseline firmware (stock `wt32eth01`):

| Condition | Framing errors | Refresh |
|---|---|---|
| **Idle** (no Art-Net) | **0 / 90 s** (2.0 M slots) | steady 40.1–40.3 Hz |
| **Heavy Art-Net flood** (48 universes @50 Hz) | **13 / 168 s (~4.4/min)** | frequent dips to 32–36 Hz |

The idle run is the analyzer's **noise-floor control**: 0 errors over 2 million slots proves the analyzer
does not invent framing errors, so the under-load errors are real. ~4.4/min matches KM-LED's ~4/min. The
framing errors **cluster on the refresh dips** — the fingerprint of the DMX transmit being preempted.

## 3. Root cause

### 3a. What it is NOT (a false lead, disproven by measuring)

First hypothesis: "the lwIP TCP/IP task floats onto core 1 on the non-v4 boards; pin it to core 0 with
`CONFIG_LWIP_TCPIP_TASK_AFFINITY_CPU0=y` like `luxdmx_v4` does."

**Wrong — that setting is a no-op.** Stock arduino-esp32 already ships
`CONFIG_LWIP_TCPIP_TASK_AFFINITY_CPU0=y` for **every** ESP32 variant (verified in
`~/.platformio/packages/framework-arduinoespressif32-libs/esp32/sdkconfig` and the S3's). lwIP was
already on core 0 in the baseline. The `luxdmx_v4` platformio.ini lines (`CONFIG_LWIP_TCPIP_TASK_AFFINITY_*`)
are redundant with the default, and adding them to the WT32 changes nothing. Building a firmware with
those lines confirmed it: `Replace: CONFIG_LWIP_TCPIP_TASK_AFFINITY_CPU0=y with: ...=y` (already set).

### 3b. What it actually is

The DMX transmit runs from `loop()` on **core 1** (`sendDmx()` → `dmx_send()`, `ARDUINO_RUNNING_CORE=1`).
The ESP32 internal EMAC's RX interrupt is allocated on **whichever core calls `ETH.begin()`**.

In `src/main.cpp`, the two wired paths were asymmetric:

- **W5500 SPI** (esp32dev / esp32s3 / luxdmx_v4): `startEthSpi()` brings Ethernet up on a **core-0 task**
  — `xTaskCreatePinnedToCore(ethUpTask, "ethup", …, 0)` — *deliberately, so its ISR sits off the DMX core.*
- **RMII / LAN8720** (WT32-ETH01): `startEthRmii()` called `ETH.begin()` **inline in `setup()` on core 1**.
  So the EMAC RX interrupt landed on **core 1 — the same core as the DMX transmit.**

Under a busy wired link the EMAC RX interrupt storm preempts the DMX break/frame generation on core 1 →
framing errors on the output. This is the real "core separation `luxdmx_v4` (W5500) has but the WT32
(RMII) doesn't" — it was never the sdkconfig line, it's the **bring-up core**. It also explains the whole
gradient: wired RMII worst (EMAC on core 1), WiFi less (the WiFi task is already core 0), AP/idle zero.

## 4. The fix

Bring `startEthRmii()` up from a task pinned to **core 0**, mirroring the W5500 `ethUpTask`, so the EMAC
RX interrupt is allocated on core 0, off the DMX core. `src/main.cpp`, ~15 lines, **no sdkconfig / no
platformio.ini change**:

```cpp
static volatile bool s_ethRmiiUpDone;
static void ethRmiiUpTask(void *arg) {
    int phy = constrain(cfg.rmiiPhy, 0, RMII_PHY_COUNT - 1);
    ETH.begin(rmiiPhyType(phy), cfg.rmiiAddr, cfg.rmiiMdc, cfg.rmiiMdio,
              cfg.rmiiPwr, rmiiClkMode(cfg.rmiiClk));
    ETH.setHostname(cfg.hostname.c_str());
    applyEthStaticIp();
    waitEthLink();
    s_ethRmiiUpDone = true;
    vTaskDelete(NULL);
}
static void startEthRmii() {
    // ... log ...
    s_ethRmiiUpDone = false;
    xTaskCreatePinnedToCore(ethRmiiUpTask, "ethrmii", 8192, NULL, 5, NULL, 0);
    uint32_t t0 = millis();
    while (!s_ethRmiiUpDone && millis() - t0 < 30000) delay(20);
}
```

### 4a. Verification (same flood, same window, only firmware differs)

| Firmware | Framing errors | Refresh |
|---|---|---|
| Baseline (RMII EMAC on core 1) | **13 / 168 s (~4.4/min)** | dips to 32–36 Hz |
| **Fixed (RMII EMAC on core 0)** | **1 / 168 s (~0.3/min)** | dips to 31–38 Hz |
| Idle control (either) | 0 | steady 40 Hz |

**Framing errors ~13× lower — essentially eliminated.** The WT32 also rebooted straight back onto
Ethernet after the OTA, so the core-0 RMII bring-up is safe on real hardware (no strand risk realised).

### 4b. Known remainder (benign, separate)

The **refresh dips (31–38 Hz) persist** in both builds. That is `loop()`'s send *cadence* jittering under
load, not frame corruption — the frames it emits are now well-formed. DMX tolerates a variable 31–40 Hz
fine, so this does not affect #64. If a rock-steady rate is wanted later: a dedicated high-priority DMX
send task, or pin the Arduino event task to core 0 (`CONFIG_ARDUINO_EVENT_RUNNING_CORE=0`). Follow-up, not
required to close the issue.

## 5. The test rig — RP2350 DMX framing-error analyzer

`RDM/src/dmxa_rx.pio` + `serviceAnalyzer()` in `RDM/src/main.cpp`:

- A dedicated **pio1 state machine** samples **8 data bits + the stop bit** of every slot; **framing
  error = stop bit not high**. Read-only, alongside the RDM engine, never transmits — a pure receiver
  like a tester.
- Break/frame boundaries from the **gap** between slot arrivals; the single 0x00 placeholder the PIO
  emits during a break is dropped via a one-slot pending-commit.
- Reports framing errors (total + /min), refresh Hz, slots/frame, start code, approx break µs, signal
  flag. Serial `a` / `ar` (reset); web **Analyzer** tab (`http://<rp-ip>/`); `GET /api/metrics` `an*`
  fields; `POST /api/analyzer/reset`.
- Known minor: reads 512 slots/frame vs the true 513 (a one-slot off-by-one in the break boundary),
  which does not affect the framing-error total.

Flood tool used: `C:/tmp/artnet_flood2.py` (48 universes @50 Hz, 4 threads). OTA to the WT32:
`curl -F firmware=@firmware.bin http://<ip>/ota/upload` (app slot, NVS preserved, no auth).

## 6. Shipping

- The fix is a `src/main.cpp` change only. **Not committed/pushed** (implemented in the detached
  `origin/master` worktree `C:/tmp/luxdmx-master`). `src/**` on master **auto-releases to OTA**, so it
  goes out via a normal reviewed PR, not from here.
- The earlier sdkconfig/platformio.ini idea is dropped (§3a, it's a no-op). No platformio.ini change is
  needed for this fix.

## 7. Reply to KM-LED (draft, when it ships)

Straight and human: found it, it's a real one. On the WT32 the wired-Ethernet driver was starting on the
same CPU core as the DMX output, so a busy network could nudge the DMX timing and the tester saw framing
errors. Moved the Ethernet startup to the other core (the W5500 boards already did this); on the bench it
dropped framing errors from ~4–5/min under heavy Art-Net to basically zero. Fix will be in the next
release. Thanks for the detailed report + the Swisson numbers, that's what made it findable.
