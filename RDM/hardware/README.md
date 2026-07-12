# DMX/RDM bench test-rig carrier PCB

KiCad project for the socketed carrier described in [TEST_RIG_PCB.md](TEST_RIG_PCB.md).
It holds the bench modules in female headers (sockets) so the rig is solid, no breadboard.

The board is generated from a script so the wiring is the source of truth and can't drift.
`build_test_rig.py` places every part and assigns every net, then drops the parts in a
**staging grid, unplaced and unrouted on purpose** so you do the layout by hand. The
ratsnest shows every connection while you place, so it can't get miswired.

## Files

| File | What it is |
|---|---|
| `build_test_rig.py` | Generates `test_rig.kicad_pcb` + `.kicad_pro` + `test_rig_netlist.txt`. Edit here, not the board. |
| `test_rig.kicad_pcb` | The board: 18 footprints, 20 nets, staged, DRC-clean apart from the ratsnest. |
| `test_rig_netlist.txt` | Human-readable net list (ref.pad per net). Handy while routing. |
| `route_test_rig.py` | Autoroute with Freerouting once you've placed the parts (reuses the jar + JDK25 in `../../hardware/tools`). Width via `FR2_TRACK` env (default 1.0mm; 1.5mm also routes). Forces the width in the exported DSN. |
| `add_pin_silk.py` | Adds a function/GPIO silk label to every used pad on the placed board (1.0mm, offset ~5-6mm out). Run one footprint at a time in a fresh process (pcbnew's write path is flaky): `for r in J_PICOA J_PICOB ...; do python add_pin_silk.py $r; done`. |
| `gen_fab_test_rig.py` | Fab package: gerbers+drill zip, BOM, placement CSV. Refuses to emit anything while any net is unrouted. |
| `test_rig_gerbers.zip` | 2-layer gerbers + Excellon drill (AUX origin). Send this to the board house. |
| `test_rig_BOM.csv` / `test_rig_CPL.csv` | Buildable BOM + placement reference (this board is hand-assembled). |

Regenerate (KiCad 10 bundled python):

```bash
"/c/Program Files/KiCad/10.0/bin/python.exe" build_test_rig.py
```

## Parts on the board (reduced set)

Every part has a **function label on the silkscreen** (the Value field, on F.Silk) so
it's obvious what each one is, and the label moves with the part when you place it.

Sockets: RP2350 Pico Plus 2 W (2x 1x20), ESP32-S3-DevKitC-1 (2x 1x22), 2x MAX485
(2x 1x5 each, RXD/TXD variant, **cross-wired**), W5500 (2x5).

No jumpers: the MAX485 enable pins go straight to the MCU GPIOs (sim GP2, S3 GPIO8),
and all 5V pins tie to one rail. Power the whole rig from one USB (either board);
the other board runs off the shared rail. Plug both USB cables and they'll fight a
little (that's fine on a bench). Pico VBUS is left unconnected; it sources/sinks 5V
through VSYS. The W5500 runs off its 5V pin (its 3V3 pin is left NC).

Resistors, THT leaded so you can swap them by hand: bias `Rb1/Rb2` (~270R, A->+3V3 /
B->GND at the sim node) and the 2:1 ADC dividers `Rd1..Rd4` (10k, BUS_A->A1, BUS_B->A0).

Headers/connectors: measurement `J_MEAS` (`A B 3V3 GND 5V TX RX`), logic-analyzer
`J_LA` (2x8, signal row + full GND row), and `J_TERM`, a 3-pin screw terminal
(`A / B / GND`) for the DMX bus breakout.

**Left off** per request: external 5V input, power-good LEDs, decoupling caps, the
120R terminators, all jumpers (EN direction, 5V source select, W5500 3V3 select), and
the XLR. The SM712 TVS went with the XLR (it was the protection at that connector) —
say the word if you want any of these back.

## The lessons from the brief that are baked into the wiring

- **Cross-wired MAX485.** module RXD (RO) -> MCU RX, module TXD (DI) -> MCU TX, on
  both nodes. This is the swap that cost hours twice. The socket pin order runs
  bottom->top on the module (pad1 = GND, pad5 = EN), matched in the mapping.
- **Pico 3V3 from pin 36 (OUT), never pin 37 (3V3_EN).** pin 37 is left unconnected.
- **Bias at one node**, referenced to +3V3_SIM (the sim's 3.3V), A->3V3 / B->GND.
- **One common ground** (32 pads on GND) shared by both nodes, bias, dividers, breakout.
- Analog probe reads `BUS_A->A1 (GP27)`, `BUS_B->A0 (GP26)`, 2:1 divider, firmware x2.

Placement tip from the brief: keep the sim's GP0 (RX) and GP1 (TX) traces apart with a
ground trace between them, and keep each MAX485 close to its socket. Pour a solid ground
on both layers when you route.

## Routing + fab

Route by hand, or run `route_test_rig.py` to let Freerouting do the copper (GUI visible).
It routes at 1.5mm by default (`FR2_TRACK=0.8 ... route_test_rig.py` for thinner). Then
`gen_fab_test_rig.py` runs KiCad's DRC as a hard gate (0 unrouted or no output) and writes
`test_rig_gerbers.zip` + the BOM + placement CSV.

Build: order the bare 2-layer PCB from the gerber zip, solder the sockets / THT resistors /
pin headers / screw terminal, then plug the four modules into their sockets. It's a
hand-assembled bench board, no SMT.
