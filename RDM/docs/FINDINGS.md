# LuxDMX findings & open issues (discovered while building the RDM simulator)

Running log so nothing gets lost. Newest first. Each entry: what, evidence, status, where to
look. "LuxDMX" here = the ESP32-S3 controller firmware in `c:/dev/DMX/src`. "Sim" = the RP2350
RDM responder in `c:/dev/DMX/RDM`.

---

## 2026-07-07 — FULL RESOLUTION: RMT-based DMX TX = hard-zero framing + 40 fps under ANY load

The core-separation work below (DMX task on core 1, receive on core 0) fixed realistic load but left a
residual: under an adversarial flood (16+ universes / 640+ pkt/s) esp_dmx still bursts framing errors,
because the ESP32 EMAC-DMA storm delays esp_dmx's break/frame **GPTimer ISR** on core 1. Putting that
ISR in IRAM was tried and **broke esp_dmx's TX entirely** (both variants; confirmed with serial logs on
the WT32). So esp_dmx's UART+GPTimer approach can't be made contention-proof here.

**The fix that works: drive DMX from the RMT peripheral** (`src/dmx_rmt.h`, ~150 lines, using the stock
IDF RMT driver — no esp_dmx fork). The RMT clocks a precomputed (level,duration) symbol stream out
**entirely in hardware**; the CPU only fills a buffer, so core-0 DMA has nothing in the bit-timing path
to disturb. A late RMT refill just idles the line (benign mark) instead of corrupting a break.

Implementation: 1 MHz resolution (1 tick = 1 µs; a 4 µs DMX bit = exactly 4 ticks, hardware-exact); a
256-entry **per-byte LUT** (each 8N2 byte is an even number of runs = whole RMT words) so encoding a
frame is just memcpys (fast enough for 40 Hz); break/MAB as one word; `eot_level=1` idles HIGH between
frames. **Both outputs = two RMT channels kicked concurrently and waited together → both hold 40 Hz.**
**Hybrid:** an output with a DE pin (`rtsPin >= 0`, RDM-capable) stays on esp_dmx (RDM is bidirectional,
RMT can't RX); every plain-DMX output uses RMT. So RMT where we can, esp_dmx only where RDM needs it.

**Measured (ground-truth UART, `gtOverrun`=0), WT32-ETH01, dual-RMT:**

| Load | esp_dmx framing | **RMT framing** |
|---|---|---|
| 16 universes (640 pkt/s) | 2301 | **0** |
| 32 universes (1280 pkt/s) | thousands | **0** |
| 48-universe 4-thread slam (344 fps in) | thousands | **0** |

All at a flat **40.0 fps on both channels**. The `outfps` web stat was also fixed to report the real
transmit rate (counted in the DMX task), not the input-match rate.

**Status / remaining:** validated on the WT32 (classic ESP32) only. Before ship: test on esp32/S3/the LuxDMX board
(the **S3 has RMT-DMA** → even more autonomous, set `flags.with_dma`), re-verify RDM still works on a
LuxDMX/S3 (esp_dmx path, unchanged), clean up a one-shot `rmt: flush timeout` logged at init (benign).
Gated behind `-DDMX_RMT`. In the worktree `C:/tmp/luxdmx-master`, not committed/pushed.

---

## 2026-07-07 — RESOLUTION: rock-solid 40 fps + 0 framing at realistic load via DMX-task + core-separation

After the ground-truth work (below) confirmed the framing errors are real but bursty, the fix that
actually works is a proper **core separation of the DMX transmit from the network receive**, built and
validated on the WT32-ETH01 with the hardware-UART ground truth (`gtOverrun`=0 throughout):

**The architecture (all in `src/main.cpp`, worktree `C:/tmp/luxdmx-master`):**
1. **`dmxTxTask`** — dedicated DMX transmit task, **core 1**, priority 19, strict 40 Hz via
   `vTaskDelayUntil`. Sole owner of the DMX ports (also runs `rdmService`). Parallelised output sends
   (fire all `dmx_send`, then wait all) so a 2nd output doesn't halve the rate.
2. **`netRxTask`** — Art-Net/sACN receive + idle re-merge moved to **core 0**. This is the crux:
   esp_dmx sequences break/MAB with a hardware-timer ISR on core 1, and `dmx_send` *yields* between
   frames (`xTaskNotifyWait`). In `loop()` the receive was serialized with the send (never overlapped);
   a naive DMX task made them run *concurrently on core 1* and the receive delayed esp_dmx's ISR →
   framing got WORSE. Moving receive to core 0 makes core 1 DMX-only → the ISR is never disturbed.
3. **`ethRmiiUpTask`** — EMAC brought up on core 0 (kept; necessary, not sufficient alone).

**Validated (hardware-UART ground truth, WT32-ETH01 on wired Ethernet):**
- 1 universe @40 Hz Art-Net, 84 s: **0 framing, flat 40.0 fps**.
- 2 universes @40 Hz Art-Net, 180 s: **0 framing, flat 40.0 fps** (the earlier one-off "34" did not recur).
- 1 universe @40 Hz **sACN** (E1.31 unicast), 78 s: **0 framing, flat 40.0 fps** — same as Art-Net.
- Load sweep: rock-solid through ~8 universes (~320 pkt/s). **Knee at ~8-16 universes**: beyond that a
  pathological broadcast flood (e.g. 16-48 universes to a 1-2-output gateway) still produces framing
  bursts — likely ESP32 APB-bus/DMA contention from core-0 saturation, an inherent HW limit; the
  refresh stays a flat 40.0 the whole time. Real gateways see 1-2 (their own) universes, so this is a
  non-issue in practice, but it's an honest limit under adversarial load.

**Big win vs the old behaviour:** refresh is now a **flat 40.0 fps** (was dipping to 30-38 Hz under
load); framing is **0** at realistic load (was ~34/min bursts on the baseline). The refresh-rate
stability is unconditional (holds even at extreme load).

**2-channel confirmed:** with Output A (GPIO4) + Output B (GPIO33) both enabled and both universes
driven @40 Hz, Output A held a **flat 40.0 fps** (parallel-send fix — the old serial `dmx_wait_sent`
between outputs would have halved it to ~20). Output A framing was 0 for ~66 s then one 34-error burst
(the same rare stochastic residual). Output B not directly tapped; identical by symmetry (same task,
same code path).

**Residual / honest limits:** rare stochastic framing bursts still appear under higher load (knee
~8-16 universes / 320-640 pkt/s; 32 universes bursts reliably). Refresh stays a flat 40.0 throughout.
Chased it: leading hypothesis is that heavy core-0 **EMAC-DMA / bus contention** under an adversarial
flood delays esp_dmx's break/frame GPTimer ISR on core 1 (the one thing that scales with pkt/s and
survives every task/core arrangement). The principled fix — put esp_dmx's ISRs in IRAM
(`-DDMX_ISR_IN_IRAM` + `CONFIG_GPTIMER_ISR_IRAM_SAFE`) so bus/cache contention can't stall them —
**broke the DMX driver entirely** (`outfps 0`; esp_dmx's GPTimer registration is incompatible with the
IRAM-safe GPTimer config). Reverted. So the extreme-load residual looks like an ESP32 **hardware**
contention limit that isn't fixable in software with this DMX stack; eliminating it would need a
different, more autonomous output path (e.g. RMT-based DMX). It is a **non-issue at realistic load**
(1-2 universes = a clean 0), which is what real gateways see. Flat 40.0 fps is unconditional regardless.

**Still to do before ship:** verify on esp32/esp32s3/luxdmx_v6 (only wt32eth01 tested); verify RDM still
works on a LuxDMX/S3 (the DMX task now owns the bus + runs rdmService); chase the rare residual bursts if a
true hard-zero is required. Not committed/pushed. `src/**` on master auto-releases to OTA, so this ships
via a reviewed PR after multi-board + RDM validation.

---

## 2026-07-07 — CORRECTION (later same day): the framing-error measurement below is NOT trustworthy; fix UNPROVEN

**Read this before the entry below.** The "reproduced ~4.4/min → fixed to 0" result below was measured
with a PIO DMX analyzer whose framing detection turned out to be unreliable, so **the conclusion does
not hold and the core-0 RMII fix is UNPROVEN**:

- **Tool contradiction.** After hardening the analyzer to detect framing errors *structurally* (a
  stop-low byte's position in the frame) instead of by *wall-clock gaps*, it reports **0 framing errors
  on the BASELINE too** — the same firmware the original analyzer scored at 13/168 s. Same board, same
  flood, two detectors, opposite answers.
- **Both detectors have a failure mode.** The gap-based one produces false *positives* when `loop1()`
  drains the RX FIFO in a burst (confirmed: `rxStall`/RXSTALL latched under load → dropped bytes,
  bunched timestamps). The position-based one produces false *negatives* at the frame boundary — which
  is exactly where a real error would appear, because an ESP32 hardware UART cannot corrupt a byte
  mid-transmission from CPU contention; the only contention-sensitive thing is esp_dmx's **break/MAB**
  generation at the boundary.
- **Physics reframe.** Within-byte stop-bit framing errors from core contention are essentially
  impossible (bits are hardware-clocked). KM-LED's Swisson "framing errors" are most likely **break/MAB
  / frame-timing violations**, a symptom class neither PIO analyzer measures well. The refresh-rate
  *jitter* we can see is real-ish but present in BOTH baseline and fixed builds at similar magnitude, so
  even a timing benefit from the fix is unproven.

**GROUND-TRUTH RESULT (2026-07-07, hardware-UART reference, `gtOverrun`=0 on every run = trustworthy):**
the framing errors ARE real, but they come as **stochastic bursts** (~35-65 errors at once, irregular)
under sustained heavy Art-Net load, and they occur on **BOTH** the baseline and the core-0-fixed
firmware. Steady-state (settled past the flood-start transient) matched-window runs:

| run (steady-state) | baseline (RMII core 1) | fixed (RMII core 0) |
|---|---|---|
| 108 s | 37 | 0 |
| 180 s | 126 | 0 |
| ~198 s | — | 63 |
| **avg** | **~34/min** | **~7.8/min** |

The fix averages ~4x fewer, but variance is huge (fixed = 0, 0, 63) and the fixed firmware STILL bursts,
so **the core-0 RMII fix is UNPROVEN and does NOT eliminate the bursts** — the ~4x is suggestive, not
established with n=2-3 runs. Because the bursts survive moving the EMAC ISR off core 1, the dominant
mechanism is probably `loop()`-level, not the ISR: `sendDmx()` and `artnet.read()`/`mergeOutput()` share
core 1, so a burst of packets delays the DMX break/MAB generation. The refresh dips (30-40 Hz) also
persist on both.

**Ground-truth tool** (the trustworthy one): the RP's HARDWARE UART (uart1 @250k 8N2 on GP5, wired to
WT32 GPIO4). Real framing error = FE set & BE clear; break = BE; `gtOverrun` (OE) must stay 0 or the run
is void. Serial `u`/`ur`, `/api/metrics` `gt*`. Both the gap-based AND the position-based PIO analyzers
proved unreliable (opposite errors) — do not trust them; use the UART.

**Status / next:** the honest verdict is INCONCLUSIVE — need (a) long-soak runs (10-20 min each) to
average out the stochastic bursts into a stable errors/hour, and/or (b) a more robust fix that decouples
the DMX transmit from network processing (a dedicated high-priority DMX task, or hardware-timed
break/MAB), then A/B it the same way, and (c) possibly a steadier Art-Net source (the 4-thread Python
flood may micro-burst and exaggerate). The core-0 RMII change is kept as a low-risk cleanup (mirrors the
W5500 path) but is NOT a validated fix. Everything below is retained for the record but superseded.

---

## 2026-07-07 — WT32-ETH01 DMX framing errors = RMII EMAC interrupt on the DMX core (issue #64) — REAL cause + fix

**What:** External report [#64](https://github.com/tombueng/LuxDMX/issues/64) (KM-LED, WT32-ETH01 +
LAN8720): a Swisson XMT-120 counts DMX **framing errors** on the LuxDMX output (12 in 3 min wired;
~25 over WiFi STA; **0 in 22 min** in WiFi-AP web-only). "DMX Signal OK, 512 ch" otherwise. Happens
with FreeStyler, QLC+, and even with no Art-Net source (web-panel control), so not a software issue.

**Reproduced on the bench (RP2350 DMX framing analyzer, see below), WT32-ETH01 on wired Ethernet:**
- **Idle** (no Art-Net): **0 framing errors / 90 s**, rock-steady 40.1–40.3 Hz.
- **Heavy Art-Net flood** (48 universes @50 Hz): **~4.4 framing errors/min** + refresh dips to 32–36 Hz,
  with the errors clustering on the dips. The idle 0-over-2M-slots run is the analyzer's noise-floor
  control, so the under-load errors are real (not a measurement artefact). Matches KM-LED's ~4/min.

**FALSE lead (disproven by measuring the built sdkconfig, not guessing):** the first hypothesis was
"lwIP TCP/IP task floats onto core 1 on the other boards; pin it to core 0
(`CONFIG_LWIP_TCPIP_TASK_AFFINITY_CPU0=y`) like `luxdmx_v6` does." **Wrong — it's a no-op.** Stock
arduino-esp32 already ships `CONFIG_LWIP_TCPIP_TASK_AFFINITY_CPU0=y` for **every** ESP32 variant
(checked `framework-arduinoespressif32-libs/esp32/sdkconfig` etc.). lwIP was already on core 0 in the
baseline; the `luxdmx_v6` platformio.ini lines are redundant, and adding them to the WT32 changes
nothing. Do NOT ship that "fix".

**REAL root cause:** the ESP32 internal EMAC's RX interrupt is allocated on whichever core calls
`ETH.begin()`. The **W5500 SPI** path brings Ethernet up on a **core-0 task** (`ethUpTask` via
`xTaskCreatePinnedToCore(..., 0)`) — deliberately, so its ISR sits off the DMX core. But the **RMII /
LAN8720** path (`startEthRmii()`) called `ETH.begin()` **inline in `setup()` on core 1**, so the EMAC
RX interrupt landed on **core 1 — the same core as `sendDmx()`/`dmx_send()`**. Under a busy wired link
the EMAC interrupt storm preempts the DMX break/frame generation → framing errors + refresh jitter.
That is the real "core separation luxdmx_v6 (W5500) has but the WT32 (RMII) doesn't" — it was never the
sdkconfig line, it's the bring-up core. Explains wired-worst / WiFi-less / AP-idle-zero exactly (WiFi
task is already core 0).

**Fix:** bring `startEthRmii()` up from a task pinned to core 0 (`ethRmiiUpTask`), mirroring the W5500
`ethUpTask`, so the EMAC RX interrupt is allocated on core 0, off the DMX core. ~15-line firmware
change in `src/main.cpp` (no sdkconfig, no platformio.ini change). **Status:** implemented in the
master worktree, building/measuring on the rig now (A/B: ~4.4/min → expect ~0). Not committed/pushed.

**Test rig (built this session):** the RP2350 sim now doubles as a **DMX framing-error analyzer**
(Swisson-style). Dedicated pio1 SM samples 8 data + stop bit of every slot (`RDM/src/dmxa_rx.pio`),
framing error = stop bit low; break/frame boundaries from the inter-slot gap. Reports framing errors
(total + /min), refresh Hz, slots/frame, start code, break µs, signal flag. Serial `a`/`ar`, web
**Analyzer** tab, `/api/metrics` `an*` fields, `POST /api/analyzer/reset`. This is what reproduced and
quantified the bug above. (Minor: slots/frame reads 512 vs 513 — a one-slot off-by-one in the
break-boundary count, does not affect the framing-error total.)

---

## 2026-07-02 — ~30% of RDM requests corrupted at the sim during discovery  (NOT an S3 bug; rig + sim turnaround; needs LA to fully close)

**What:** A spec-compliant, checksum-validating RDM responder (RP2350 sim) on the LuxDMX bus sees
roughly **30% of the controller's `DISC_UNIQUE_BRANCH` requests arrive with a bad checksum**
(badCsum 100 / rdmReq 326 in one run). A compliant fixture must reject those, so it stays silent,
the controller loses that branch, and multi-fixture discovery collapses (0 of N found for a spread
bus). Deep binary-search descent multiplies the effect (needs many clean turnarounds in a row).

**Why it matters:** ANY compliant fixture would reject the corrupted requests the same way, so
crowded-bus RDM on THIS rig is unreliable. See the UPDATE below: the S3 itself is fine; the
corruption is rig physical-layer + the simulator's own half-duplex turnaround.

**Evidence / ruled out:**
- The S3 is NOT dropping the sim's *responses*: the direct metric (controller re-asking a branch it
  already got a reply for) stayed 0–5 out of hundreds — the primary "does the S3 catch responses"
  concern looks fine on this bus.
- Not FIFO overflow (`RXSTALL`=0). Not idle noise (badCsum/rdmReq flat over 5 s idle — corruption
  only appears while real RDM traffic flows, i.e. at the half-duplex turnarounds). Not the sim's
  response timing (250 µs, in spec). The sim decodes ~70% of requests correctly and has driven a
  full depth-30 binary search, so its RX fundamentally works.
- The earlier "4/4 discovered" success used a lenient decoder that skipped checksum validation and
  so accepted corrupted requests — it masked the problem. Validating the checksum (as a real
  fixture does) is what exposes it. **Do not loosen the decoder to make it "pass".**
- Driving the bus with DMX (outfps≈31) did not help — the controller pauses DMX during the blocking
  discovery sweep, so the bus floats during the RDM exchange regardless.

**UPDATE — corrected after operator input + isolation test:** bias IS present on the 485 bus, and
the S3 was reset fresh via its COM port (COM5) before a run. Neither changed the ~30%, so it is NOT
missing bias and NOT accumulated controller state. A **listen-only** test (sim decodes but never
transmits) split the number: **~9% baseline corruption with the sim silent** + **~21% added by the
sim's own half-duplex turnaround** (its RO tri-states while it drives, and the RX SM clocks float /
adjacent-GPIO crosstalk, then resumes mid-byte). Conclusions:
- **NOT an S3 RDM-RX bug** — the S3 catches its responses (reAsk≈0). The paper's ESP32 weakness did
  not manifest here. This is the reassuring headline.
- The ~9% baseline is a **rig physical-layer** issue (RS485 wiring / the sim's MAX3485 breakout /
  connectors / sim RX front end) and/or the controller's TX — a logic-analyzer capture is needed to
  say which. The ~21% is a **simulator/breadboard limitation**, not LuxDMX.
- `rxReset` (SM disable/restart) and a GP0 pull-up both make the sim's RX *worse* (kill it) on
  RP2350/arduino-pico; only clearing the FIFO works. A break-detecting RX PIO + a real PCB (RX/TX
  not adjacent, defined RO level during TX) is the path to a reliable crowded-bus sim.

**Next (do NOT loosen the checksum-validating decoder):** logic-analyzer capture of one turnaround to
prove the controller's TX is clean on the wire (which would fully clear the S3 and pin the ~9% on rig
wiring); then rebuild the sim's RS485 front end to kill the ~21% turnaround share.

**HARDWARE ROOT CAUSE (in progress, likely the whole thing):** the sim's RS485 receiver floods with
~14–29k bytes/s of **noise on an idle bus** (should be ~0). MAX3485/3486 have NO built-in fail-safe:
the RX threshold is +/-200 mV, so if the idle differential V(A-B) < +200 mV the output oscillates on
noise. V(A-B) = Vcc·Rterm / (Rterm + 2·Rbias). At **3.3 V** (Pimoroni) with the ~500 Ω bias and
**termination at both ends** (60 Ω effective), V(A-B) ≈ **187 mV — under threshold** → the flood.
(One terminator → 354 mV, fine. At 5 V the same 500 Ω would be fine → 3.3 V is the aggravator, not a
chip fault.) After reattaching the S3's MAX485 GND the idle noise halved (29k→14k) and discovery went
0/8 → 5/8, confirming direction. **FIX: drop bias to ~220–330 Ω** (330 Ω → ~275 mV, 220 Ω → ~396 mV at
3.3 V/2 terms), or remove one terminator, and confirm a solid common GND between both transceivers.
Success test: idle RX at the sim → ~0 bytes/s, then discovery should complete and scale.
Sim console `l` = listen-only, `m` = metrics; watch the `[hb] rxBytes=` rate on an idle bus.

Full write-up + data table: `RDM_S3_RX_RELIABILITY.md`.

---

## 2026-07-01 — Pin-picker reserves the W5500's own pins against the W5500  (CONFIRMED, real bug)

**What:** In the S3 web config pin-picker, selecting the `luxdmx_v6` board template flags the
W5500 Ethernet pins (GPIO9–14) as conflicting — with the W5500 itself. A peripheral's own pins
should not be reported as a conflict against that same peripheral.

**Status:** Flagged to the parallel `feat/pinpicker-physical` workstream; not fixed here. Belongs
to the pin-picker validation logic (self-conflict should be excluded).

---

## 2026-07-01 — `rdmBusy` doesn't actually gate DMX output  (minor / cosmetic)

**What:** `rdmDoDiscover()` sets `rdmBusy=true` with a comment that discovery "blocks the bus …
DMX output pauses briefly", but `rdmBusy` is only read by `/rdm.json` reporting — `sendDmx()`
never checks it. In practice DMX does pause during discovery anyway, because both `sendDmx()` and
`rdmService()` run on the single `loop()` thread and `rdmDoDiscover()` blocks it. So the behaviour
is fine; the flag/comment just imply a gate that isn't there.

**Status:** Cosmetic. Worth a one-line comment fix or actually gating `sendDmx()` on `rdmBusy` for
clarity. `c:/dev/DMX/src/main.cpp` around the `rdmBusy` / `sendDmx` definitions.
