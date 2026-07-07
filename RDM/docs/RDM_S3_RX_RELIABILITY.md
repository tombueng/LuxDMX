# Does the LuxDMX S3 catch every RDM response? — investigation

**Status: OPEN — root cause narrowed to bus signal integrity; needs a logic-analyzer capture
and/or a bus-bias fix to close.** Read the whole thing before acting; the headline is nuanced.

## The question
The hard requirement: the LuxDMX ESP32-S3 controller must receive EVERY spec-compliant RDM
response. A dropped discovery response = a fixture it can never find. Prior work (a paper) flagged
the ESP32 UART's RDM-RX timing weakness, so this is not hypothetical.

Two very different causes of a "missed fixture", which must be kept apart:
1. **Simulator out of spec** — the RP2350 responder answered outside E1.20 timing (<176 µs) or
   emitted a malformed frame. The controller correctly ignores these; NOT an S3 bug.
2. **S3 drops in-spec responses** — a real controller RX bug, to be fixed in the S3, never masked.

## What was actually found (headline)
- **The S3 is NOT dropping the simulator's responses.** The direct metric `S3-dropped-replies`
  (controller re-asks a `DISC_UNIQUE_BRANCH` branch it already got a reply for) stayed **0–5 across
  every run, out of hundreds of responses** — i.e. well under a couple percent, and often zero.
  On the primary concern (does the S3 catch responses), the S3 looks fine on this bus.
- **The dominant failure is the opposite direction: the controller's *requests* arrive corrupted.**
  The simulator counts `badCsum` = frames that start `0xCC 0x01` with a valid length but a **bad
  checksum**. During discovery this ran at roughly **30%** (e.g. badCsum 100 / rdmReq 326). A
  corrupted request → the responder can't validate it → stays silent → the controller loses that
  branch. Deep binary-search descent multiplies this: reaching a leaf needs ~30–48 clean
  reply→request turnarounds in a row, so at 30% request corruption the search almost never reaches
  a leaf, mutes nothing, and reports 0 devices for a spread multi-fixture bus.

## Ruling things out (so this isn't hand-waving)
- **Not RX FIFO overflow / responder too slow.** PIO `RXSTALL` = 0 every time; core 1 keeps up.
- **Not idle bus noise creating phantom frames.** Over 5 s of idle with no discovery, `badCsum`
  and `rdmReq` did not move at all. The corruption only appears *while real RDM traffic flows*,
  i.e. at the half-duplex turnarounds, not from the line sitting idle.
- **Not the simulator's response timing.** Turnaround is a spec-compliant 250 µs (E1.20 window
  176–2000 µs). `S3-dropped-replies` staying ~0 confirms the responses that go out are received.
- **Not the simulator failing to decode in principle.** It decodes RDM correctly, replies with the
  exact esp_dmx-validated discovery-response and mute-ACK format, and has driven a **full depth-30
  binary search** (verbose `[dub]` trace: correct bounds, correct in-range replies, muted=0). A
  tightly-clustered 4-fixture set was discovered **4/4** earlier in the session.
- **Not fixed by driving the bus with DMX.** With Art-Net driving output (outfps ≈ 31), discovery
  still fails — because the controller pauses DMX during the (blocking) discovery sweep, so the bus
  floats during the actual RDM exchange regardless.

## Key insight: proper checksum validation exposes the corruption
The earlier "4/4 discovered" success used an early, lenient decoder that accepted any frame starting
`0xCC` with a matching message length **without validating the RDM checksum**. It therefore replied
to corrupted requests too, masking the bus problem. The current decoder validates the checksum
exactly as E1.20 requires — **which is what a real fixture does** — and that is what surfaces the
~30% request corruption. This is not the simulator being fragile; it is the simulator correctly
refusing corrupted requests. A spec-compliant fixture on this bus would fail the same way. So the
corruption is a genuine bus/signal problem to fix, not a decoder to loosen.

## Where the corruption actually comes from (isolation test, bias present, fresh controller)
Two operator corrections retested the hypotheses: **the 485 bus DOES have fail-safe bias**, and the
S3 was **reset fresh** via its COM port (COM5) before the run. Neither changed the ~30% figure, so
it is not bias and not accumulated controller state.

The decisive test was **listen-only mode** (`l` command): the sim decodes and counts requests but
NEVER transmits, so there is no half-duplex turnaround. Result over ~24 triggered scans:
- **Sim silent: ~9% of requests corrupt** (badCsum 7 / rdmReq 71), plus some missed entirely.
- **Sim replying (active discovery): ~30% corrupt.**

So the ~30% splits into two parts:
1. **~9% baseline**, present even with the sim silent, bias on, controller fresh → a **physical /
   signal-integrity** issue in the rig (RS485 wiring, the sim's MAX3485 breakout, connectors, the
   sim's RX front-end), and/or the controller's TX. A logic-analyzer capture is needed to say which.
2. **~+21% from the sim's own transmit→receive turnaround.** While the sim drives the bus (DE high),
   its transceiver RO tri-states and the RX state machine, sharing the PIO and an adjacent GPIO with
   the TX pin, clocks float/crosstalk garbage and stalls mid-byte; when it resumes, the first slots
   of the next request can be missampled. This is a **simulator/breadboard limitation**, not a
   LuxDMX bug.

### Things that did NOT help the turnaround part (tried on hardware)
`clear_fifos` after TX (best, runs full searches), FIFO clear vs none, a GP0 pull-up, a post-TX
settle delay, and disabling+restarting the RX SM (`rxReset`). **`rxReset` and the pull-up both make
it worse — they intermittently leave the RX dead** on this arduino-pico/RP2350 setup, so the SM must
be left running and only the FIFO cleared. A proper fix likely needs a break-detecting RX PIO and/or
cleaner electrical isolation (a real PCB rather than a breadboard, RX/TX not adjacent, guaranteed
idle level on RO during TX).

## Bottom line for LuxDMX
- **No S3 RDM-RX bug found.** The S3 catches the responses it is sent (`reAsk` ≈ 0). The paper's
  ESP32 RDM-RX weakness did not manifest here.
- The discovery failures are **request-side corruption on the rig** (physical + the sim's own
  turnaround), not the controller dropping responses.
- To fully close it: **logic-analyzer capture** to see whether the controller's TX is clean on the
  wire (then the ~9% is rig wiring, not the S3), and give the simulator a cleaner electrical front
  end so its own turnaround stops adding corruption.

## Data (representative)
| config | driven? | sweeps all-found | S3-dropped-replies | responses | notes |
|---|---|---|---|---|---|
| 1 fix @250µs | idle | 1/1 (earlier) / 0/N (later) | 0 | 48 (good) / 0–12 (bad) | highly variable |
| 4 fix @250µs | idle | 0/4 | 0–1 | 1–77 | one trial got 1/4 |
| 4 fix @250µs | DMX 31 fps | 0/5 | 0–1 | 1–74 | driving didn't help |
| 8 fix @250µs | idle | 0/6 | 0–5 | 0–229 | badCsum ~30% |
| 4 fix (clustered) | (early session) | 4/4 | 0 | ~hundreds | basic RDM proven |

## Next steps to CLOSE this (do not "fix" by relaxing anything)
1. **Logic-analyzer capture** of one discovery on the wire (the rig's custom S3 LA on COM9): see the
   exact bytes/edges at each turnaround, confirm whether the controller's TX is clean and the
   corruption is on the float→drive transition.
2. **Add fail-safe bias** to the bus (or the v4 board) and re-run the crowded-bus sweep. If request
   corruption drops to ~0 and discovery finds all fixtures → confirmed hardware root cause; fix is a
   board change (bias resistors) + a documented external-bias requirement. This is a real LuxDMX
   hardware finding, not a simulator workaround.
3. Only after 1–2 are clean, re-quantify `S3-dropped-replies` at scale to give the S3-RX-catches-
   everything guarantee the hard number it deserves.

## Instrumentation added to the simulator (for reproducibility)
Serial console: `t<us>` turnaround, `f<n>` fixture count, `r` un-mute, `v` verbose DUB trace with
bounds+mute, `m` metrics (`reAsk`, `resp`, `rdmReq`, `badCsum`, `rxStall`, `muted`). Harnesses:
`scratchpad/test_nopoll.py` (trigger, silent bus, read result), `ws_bridge.mjs` (persistent WS).
