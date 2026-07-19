# DMX/RDM bench test-rig PCB — design brief (handoff)

**Goal:** a small carrier PCB that holds the bench modules in sockets so the DMX/RDM test rig is
mechanically solid, no breadboard, no loose jumpers. It wires an ESP32-S3 (the LuxDMX controller
under test) and an RP2350 (the RDM simulator) each to their own RS485 transceiver, ties them onto
one properly-terminated + biased RS485 bus, and adds a W5500 Ethernet module for the S3. Modules
sit in **female headers (sockets)** so they stay removable.

This brief is self-contained. It exists because a whole debugging session was lost to a flaky
breadboard bus (bad ground, weak bias, wrong 3V3 pin, RX/TX crosstalk). The "Design rules /
lessons" section is the important part, do not skip it.

---

## 1. Modules to socket (with the user's measured footprints)

Pitch is 2.54 mm (0.1") throughout. "W×L" = holes wide × holes long.

| Module | Footprint (holes) | Header layout | Notes |
|---|---|---|---|
| **ESP32-S3 dev module** (LuxDMX controller / DUT) | 9 × 22 (≈22.86 × 55.88 mm) | dual-row, rows **9×2.54 = 22.86 mm** apart, ~22 pins/row | e.g. ESP32-S3-DevKitC-1 style (0.9" row spacing). Runs the LuxDMX firmware. |
| **RP2350 — Pimoroni Pico Plus 2 W** (RDM sim) | 7 × 20 (≈17.78 × 50.8 mm) | standard Pico **2×20** (40-pin) header, rows **7×2.54 = 17.78 mm** apart | Pinout: standard Pico. Note the ADC-relabel trick, see §5. |
| **MAX485 module ×2** (one per node) | 6 × 5 (≈15.24 × 12.7 mm) | two 5-pin rows, **6×2.54 = 15.24 mm** apart | **RXD/TXD-labelled** module, must be cross-wired, see §5. |
| **W5500 Ethernet module** (for the S3) | 2 × 5 (10-pin) | single 2×5 header | SPI + power. |

### Given pinouts

**MAX485 module (RXD/TXD variant):**
```
  LEFT header (5):   EN   VCC   RXD   TXD   GND
  RIGHT header (5):  NC   GND   A     B     NC
```
Underlying MAX485/MAX3486 IC pinout (for reference / if using bare ICs):
```
   1 RO   (=RXD, receiver out) -> MCU RX      8 VCC
   2 /RE ─┐ tie to EN                         7 B   (Data-)
   3 DE  ─┘ (=EN)                             6 A   (Data+)
   4 DI   (=TXD, driver in) <- MCU TX         5 GND
```
- `EN` = combined driver+receiver enable (DE tied to /RE). HIGH = transmit, LOW = receive.
- `RXD` = the transceiver's **receiver output (RO)**  -> goes to the MCU's **RX**.
- `TXD` = the transceiver's **driver input (DI)**    -> goes to the MCU's **TX**.
- `A` / `B` = the RS485 bus lines.
  (⚠ RXD/TXD are named from the *module's* view, so they cross to the MCU — see §5 rule 1.)

**W5500 module (2×5):**
```
  Row 1:  5V    GND   RST   INT   NC
  Row 2:  3.3V  MISO  MOSI  SCS   SCLK
```
Power the module per its regulator (most take **5V** on the 5V pin; if it's a bare 3.3V board, feed
3.3V instead). SPI logic is 3.3V.

**RP2350 Pico Plus 2 W** — standard Pico 40-pin header. Pins we use (physical pin → function):
```
  pin 1  = GP0   -> RS485 RO / MCU-RX  (from MAX485 RXD)
  pin 2  = GP1   -> RS485 DI / MCU-TX  (to   MAX485 TXD)
  pin 4  = GP2   -> RS485 DE+RE        (to   MAX485 EN)
  pin 31 = GP26 / A0  -> analog probe tap (bus line, via divider)   [silicon GP40, see §5.5]
  pin 32 = GP27 / A1  -> analog probe tap (bus line, via divider)   [silicon GP41]
  pin 36 = 3V3(OUT)   -> 3.3V power out  (transceiver VCC, bias, divider tops)   [NOT pin 37!]
  pin 3/8/13/18/23/28/33/38 = GND
```

**ESP32-S3** — pins are the current LuxDMX firmware config (`/info.json`, changeable in firmware but
wire the PCB to these):
```
  GPIO17 = DMX TX      -> MAX485 #2 TXD (DI)
  GPIO18 = DMX RX      <- MAX485 #2 RXD (RO)
  GPIO8  = DMX DE+RE   -> MAX485 #2 EN        (firmware "rts" pin)
  GPIO10 = W5500 SCS/CS
  GPIO12 = W5500 SCLK
  GPIO11 = W5500 MOSI
  GPIO13 = W5500 MISO
  GPIO14 = W5500 INT
  GPIO9  = W5500 RST
  GPIO48 = onboard LED (leave on module)
  3V3, GND, 5V/VIN
```
> The **GPIO functions above are the truth**; the physical header position of each GPIO depends on
> the exact S3 dev module (footprint given: 9×22 holes, DevKitC-1-style). Name the specific S3 module
> to lock the footprint and map each GPIO to its silk pin. Same for the Pico: full pinout is the
> standard Pico 40-pin layout (the pins we use are listed above with their physical pin numbers).

---

## 2. Complete net list (what connects to what)

**Node A — RP2350 sim ↔ MAX485 #1:**
```
  GP0  (pin1)  --- RXD (RO)      MAX485#1 left
  GP1  (pin2)  --- TXD (DI)
  GP2  (pin4)  --- EN  (DE+/RE)
  3V3  (pin36) --- VCC
  GND          --- GND (left) and GND (right)
  MAX485#1 A   --- BUS_A
  MAX485#1 B   --- BUS_B
```

**Node B — ESP32-S3 ↔ MAX485 #2:**
```
  GPIO18 --- RXD (RO)            MAX485#2 left
  GPIO17 --- TXD (DI)
  GPIO8  --- EN  (DE+/RE)
  3V3    --- VCC   (⚠ level note, §5 rule 3)
  GND    --- GND (left) and GND (right)
  MAX485#2 A --- BUS_A
  MAX485#2 B --- BUS_B
```

**ESP32-S3 ↔ W5500:**
```
  GPIO10 --- SCS      GPIO12 --- SCLK     GPIO11 --- MOSI
  GPIO13 --- MISO     GPIO14 --- INT      GPIO9  --- RST
  5V (or 3V3) --- module power     GND --- GND
```

**RS485 bus (BUS_A / BUS_B):** join MAX485#1 A↔MAX485#2 A and B↔B. Plus:
- **Termination:** 120 Ω across A–B at **each** transceiver (both bus ends) — this is a 2-node
  point-to-point bench link. Make each 120 Ω **jumper-selectable** (footprint + 2-pin jumper) so it
  can be disabled for other topologies.
- **Fail-safe bias (ONE place only):** `A --[Rb]--> +3V3`, `B --[Rb]--> GND`. Use **through-hole
  (leaded / THT) resistors**, not SMD, so the value can be swapped/tuned by hand (the bias value had
  to be trimmed empirically, see §3). Ideally socket them or use generous THT pads. See §3 for value.
- **Analog probe (RP2350):** `BUS_A --10k--(GP27/A1)--10k--GND` and `BUS_B --10k--(GP26/A0)--10k--GND`.
  Also **through-hole (leaded) resistors** (4×), so the divider ratio can be changed by hand. 2:1
  divider; firmware scales ×2. Current working assignment reads +idle with A→A1, B→A0.
- **Common ground:** BUS ground shared with **both** module grounds and the bias/termination ground,
  one solid ground pour. This is non-negotiable (§5 rule 2).

**Measurement-point header (required):** a labelled 1×7 (or 2×7) pin header for scope/DMM probing:
```
  A    B    3V3    GND    5V    TX    RX
```
- `A`, `B` = the RS485 bus lines. `3V3`, `5V`, `GND` = the rails. `TX`, `RX` = the **sim node's**
  MCU-side transceiver signals (RP2350 GP1 = DI/TX, GP0 = RO/RX) so you can watch the logic side.
  (If space allows, add a second TX/RX pair for the S3 node, GPIO17/GPIO18.)
- Put a **GND pin next to each signal** if you can (or use a 2×7 with a full ground row) for clean
  scope grounding.

**DMX bus breakout (build it in):** bring BUS_A / BUS_B / GND out to real connectors so you can plug
a **real RDM fixture** (validate the S3 against real hardware, not just the sim) or a scope/analyzer.
```
  DMX XLR pinout (this is the standard, get it right):
    pin 1 = GND / shield
    pin 2 = Data-   = BUS_B   (cold / inverting)
    pin 3 = Data+   = BUS_A   (hot  / non-inverting)
    pin 4,5 = unused (5-pin) — leave open, or a 2nd universe later
```
- 1× **5-pin XLR female** (Neutrik NC5F, DMX standard) and/or 1× **3-pin XLR** (many fixtures) —
  `A→pin3, B→pin2, GND→pin1`.
- 1× **3-pin screw terminal** (`A / B / GND`) for quick cable/scope hookup.
- **Protection at the external connector:** 1× TVS across A–B (e.g. **SM712**, like the LuxDMX board) and
  optional small series resistors — cheap insurance against ESD / mis-plugging real cables.
- The on-board **termination at this end must be jumper-disable-able**: when a real fixture is
  plugged it terminates the far end, so you don't want 60 Ω double-loading.

**Nice-to-have extras (recommended, low cost):**
- **External 5V input** (USB-C or barrel) + a jumper to pick the 5V source, so you're not juggling
  two USB cables. Plus **power-good LEDs on +3V3 and +5V** (a 3V3 LED would have caught the
  3V3-vs-3V3_EN mistake instantly).
- **EN/direction jumper** per transceiver: `force-RX / force-TX / MCU-controlled`, to force-isolate
  "who's driving the idle bus" during debugging.
- **Extend the measurement header for the logic analyzer:** include `A, B, GND` plus BOTH nodes'
  `TX/RX/EN` (sim GP0/GP1/GP2 and S3 GPIO18/GPIO17/GPIO8) so one LA capture shows the full
  request→turnaround→response.

---

## 3. Bias resistor value (the thing that caused most of the pain)

MAX485/MAX3486 are **not** fail-safe: receiver threshold is ±200 mV, so an idle bus below +200 mV
oscillates on noise. Idle differential set by the bias vs termination:

```
  V(A-B)_idle = Vcc * Rterm / (Rterm + 2*Rbias)
  Rterm = 60 Ω  (two 120 Ω terminators in parallel)
```

At **Vcc = 3.3 V** (the sim's MAX3486 supply), both ends terminated (60 Ω):

| Rbias | idle V(A-B) | verdict |
|---|---|---|
| 500 Ω | ~187 mV | **under threshold → noisy** (this was the bug) |
| 330 Ω | ~275 mV | ok |
| 250 Ω | ~350 mV (measured **+770 mV** on the real rig with light term) | **good, clean** |
| 220 Ω | ~400 mV | good |

**Recommendation for the PCB:** bias referenced to **+3V3**, `Rbias ≈ 270 Ω` per line (or a
2-footprint parallel option to trim), verified to give **≥ +400 mV** idle on the analog probe. Put
the bias network at one node (either end). If instead the bus is biased from a 5 V node, 470 Ω is
fine (that's what the LuxDMX board uses, see §6).

---

## 4. Power

- Simplest: power everything from **one USB** (either the S3 or the RP2350) and distribute its **5V**
  (VBUS/VSYS) and each board's **3V3** on the carrier. Provide a jumper to pick which board is the
  5V source, and/or a separate 2-pin 5V input.
- Each MCU's own 3.3V regulator powers its side. The MAX3486 (sim) runs off the **RP2350 3V3 (pin
  36)**. The S3's transceiver runs off the S3 3V3 (or a shared 3V3, mind level, §5.3).
- W5500 module: 5V (if it has a regulator) or 3V3 per the module.
- Decoupling: 100 nF at each transceiver VCC, bulk 10 µF near the power entry.

---

## 5. Design rules / lessons learned (READ THIS)

1. **CROSS RXD/TXD.** The MAX485 module labels are from the module's side: `RXD` is the receiver
   output (RO) → wire to the MCU **RX**; `TXD` is the driver input (DI) → wire to the MCU **TX**.
   Name-matching (MCU-TX→module-TXD... wait) is the trap. Concretely: MCU-RX ↔ module-RXD,
   MCU-TX ↔ module-TXD as pins, but electrically RX-in comes from RO and TX-out goes to DI. This
   exact swap cost hours twice on this rig (agent memory `rs485-rxd-txd-cross-wire`).
2. **Solid common ground.** RS485 is differential but still needs a shared ground reference between
   the two transceivers. A missing/marginal ground made the receiver float and oscillate; the noise
   was only present when A/B were connected. One continuous ground pour, short returns.
3. **5 V vs 3.3 V transceiver level.** If a MAX485 is a **5 V** part, its RO (pin 1 / RXD) outputs
   5 V → into the S3's 3.3 V RX = over-voltage. Use a **3.3 V MAX3485** on both sides, or put a
   divider / level shifter on RO. DI is fine (3.3 V clears the input threshold).
4. **3V3 vs 3V3_EN on the Pico.** Power the transceiver + bias from **3V3 / pin 36 (OUT)**, never
   **3V3_EN / pin 37** (that's the regulator enable input; loading it browns out the rail).
5. **The Pico Plus 2 W ADC relabel.** On the RP2350B, silicon ADC is GP40–47, but Pimoroni brings
   them out on the header positions **silk-labelled GP26/GP27/GP28** (= A0/A1/A2). So the analog
   probe wires to the pins you *see* as GP26/GP27; in the SDK/firmware they're A0/A1 (GP40/41). Both
   are the same physical pins. Keep the analog probe on the PCB (2:1 dividers → A0/A1) as a built-in
   bus-health meter, it's how the noise finally got diagnosed.
6. **Half-duplex turnaround / RX-TX crosstalk (sim side).** On the RP2350 the RX (GP0) and TX (GP1)
   are adjacent, and during the sim's transmit its transceiver RO floats; crosstalk + float added
   ~21% corruption to the sim's own turnaround. On the PCB: **keep GP0 (RX) and GP1 (TX) traces
   apart**, put a **ground trace/guard between them**, keep the transceiver close to the header, and
   consider a resistor that gives RO a defined idle level. (This is a sim-quality issue, not a
   LuxDMX issue.)
7. **Termination selectable.** Two 120 Ω terminators (both ends) is correct for this 2-node bench,
   but make each a jumper so the board also works end-of-line / with external fixtures. (E1.11 wants
   the terminator at the far end only for a real installation.)

---

## 6. Reference: how the LuxDMX board does it (for the "real" side)

The production LuxDMX board (`c:/dev/DMX/hardware/luxdmx.kicad_*`) is the gold reference for a clean RDM
front end and is worth mirroring where sensible:
- **ISO3086DWR** isolated RS485 transceiver (5 V isolated bus side via a B0505S-1W), common-mode choke
  (ACM2012), SM712 TVS, series TBU fault protection.
- **120 Ω** differential termination (R12/R19).
- **Fail-safe bias 470 Ω** A→VISO(5V) / B→GNDISO per universe (R20/R21) → ~300–560 mV idle. Correct.
- The test rig doesn't need the isolation/protection, but the term+bias topology is the model.

---

## 7. Suggested layout

- Two MAX485 sockets at the **two ends** of a short, straight A/B pair (they're the bus ends →
  termination lives at each). Keep the A/B pair tight and parallel (loosely "twisted"/coupled).
- RP2350 socket near MAX485#1, ESP32-S3 socket near MAX485#2, each MCU's RO/DI/EN short to its
  transceiver. W5500 socket near the S3's SPI pins (GPIO10-14, 9).
- Ground pour top+bottom, stitched; single ground reference for bus + both nodes.
- Bias network + the RP2350 analog-probe dividers grouped near BUS_A/BUS_B, as **through-hole leaded
  resistors** with room to reach them (they get swapped by hand during tuning).
- **Measurement header (`A B 3V3 GND 5V TX RX`) on a board edge**, easy scope/DMM access; ground pins
  interleaved if using a 2×7. Optional 3-pin bus breakout (screw terminal) off A/B/GND.
- Silk: clearly mark A and B, and mark the RXD/TXD cross so it can't be miswired again.

---

## 8. BOM (carrier only, excl. modules)

- Female headers (sockets): 2× 1×20 (or 2×20 dual) for the Pico; 2× row headers for the S3 module;
  2× (2× 1×5) for the MAX485 modules; 1× 2×5 for the W5500.
- **Bias: 2× ~270 Ω through-hole (leaded)** referenced to +3V3 (trim per §3) — hand-swappable.
- **Analog-probe divider: 4× 10 kΩ through-hole (leaded)** — hand-swappable ratio.
- Termination: 2× 120 Ω (THT or 0805) + 2× 2-pin jumpers (selectable).
- **Measurement header** labelled `A B 3V3 GND 5V TX RX` (extend for LA: + both nodes' TX/RX/EN + GND).
- **DMX breakout:** 1× 5-pin XLR female (+ optional 3-pin XLR), 1× 3-pin screw terminal (A/B/GND).
- **1× TVS across A–B** (SM712) at the external connector (+ optional series resistors).
- **3× EN-direction jumpers** (force-RX/TX/MCU), 2× termination jumpers.
- **Power:** 1× external 5V input (USB-C or barrel) + source-select jumper; 2× LED + resistor
  (power-good on +3V3 and +5V).
- 2× 100 nF + 1× 10 µF decoupling.
- Board ~ credit-card size is plenty; leave room around the THT resistors, the XLR, and the headers.

---

## 9. References
- RDM simulator firmware + docs: `c:/dev/DMX/RDM/` (`src/main.cpp`, `docs/RDM_S3_RX_RELIABILITY.md`,
  `docs/FINDINGS.md`). Sim console: `d` wiring-check LED, `m` metrics, `w` WiFi retry.
- LuxDMX S3 firmware + live pin config: `c:/dev/DMX/src/main.cpp`, and the device `/info.json`
  (tx=17, rx=18, rts=8; ethCs=10/Sck=12/Mosi=11/Miso=13/Int=14/Rst=9).
- LuxDMX hardware reference: `c:/dev/DMX/hardware/luxdmx.kicad_sch` / `.kicad_pcb`.
- Agent memories: `rs485-rxd-txd-cross-wire`, `v4-check-rdm-bias-termination`, `rp2350-rdm-fixture`.
