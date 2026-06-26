# Ruggedization (making it battle-ready)

LuxDMX gets used in places that aren't kind to electronics: touring racks, damp
basements, dimmer-heavy stages, cables that get yanked and occasionally plugged into
the wrong thing. This is the rundown of what protects the board and why.

If you just want the short version: the DMX outputs are galvanically isolated, so the
scary stuff (a DMX line shorted to power, a big ground potential difference between two
buildings, ESD off a 100m cable) hits an isolation barrier instead of the MCU. Everything
below is layered on top of that.

## What was already solid

- **Isolated DMX outputs.** Each universe runs through a B0505S isolated DC-DC plus an
  ISO3086 isolated RS-485 transceiver. Primary and secondary share no copper. A miswired
  or surged DMX cable can't reach the ESP32. This is the single biggest reason the board
  survives abuse.
- **SM712 TVS on every DMX pair.** Bidirectional 7V standoff clamp sized for RS-485/DMX,
  sitting right at the connector.
- **Isolated PoE.** The DP9900M PD module is 1500V isolated, with a SMAJ58A clamping the
  rectified 48V rail. The magjack adds its own 1500V magnetics isolation.

## What got added in the ruggedization pass

### USB ESD (U8, USBLC6-2SC6)
The USB-C data lines had no protection. Every plug/unplug is an ESD event, and the port
is the most-handled thing on the board. U8 is the standard cheap ESD array: clamps D+ and
D- to GND and to VBUS, sits right at the connector. LCSC C7519.

### Self-healing fuse (F1, PPTC 1.5A / 16V)
Resettable polyfuse in series with the USB 5V input. If something downstream shorts, it
trips and protects the cable and the host port, then resets itself once the fault clears.
1.5A hold so it never nuisance-trips at the board's ~0.8A peak, even warm. 25mΩ so it
barely drops any voltage. LCSC C883133.

The PoE side doesn't need one, the DP9900M has its own current limit.

### Lower-drop OR diodes (D8/D9, SS34 -> SS54)
The USB 5V and PoE 5V are OR'd together with diodes so neither back-feeds the other. Adding
the PTC + a ferrite in series eats into the B0505S input margin (it wants >=4.5V). Swapping
the 3A SS34 for the 5A SS54 claws back ~0.05-0.1V of forward drop, which keeps the +5V rail
above 4.5V from a clean USB supply. The B0505S is unregulated anyway, so a brief dip below
4.5V just lowers the isolated rail slightly, it doesn't stop DMX. PoE delivers a regulated
5V so that path always has margin. Tracked as validation item 9.

### +5V transient clamp (D11, SMAJ5.0A)
A TVS across the main +5V rail. 5V standoff so it doesn't conduct at the normal ~4.6-4.7V
rail, 6.4V breakdown, clamps surges and ESD that ride in on either input. Cheap insurance.

### DMX common-mode chokes (L2/L3, ACM2012-201-2P)
DMX cables are long and act like antennas, both radiating the board's common-mode noise and
picking up interference. Each universe now has a common-mode choke (200Ω@100MHz) in series
with the A/B pair, on the cable side. The signal order from the cable inward is:

```
XLR / breakout  ->  SM712 TVS  ->  common-mode choke  ->  ISO3086 transceiver
   (DMX_AO/BO)      (clamp here)     (L2 / L3)            (DMX_A/B)
```

So a surge gets clamped at the connector first, then the choke knocks down what's left
before it reaches the transceiver, and on the way out the choke kills common-mode emissions.
The choke passes the differential signal untouched (it's rated for USB2 speeds, DMX is glacial
by comparison). LCSC C383338.

To make room for the choke the net got split: `DMX_A/DMX_B` is now the transceiver side and
`DMX_AO/DMX_BO` is the cable side. The TVS, the XLR, and the J7/J8 breakout connectors all
moved to the cable side, which is what you want (they all see the same protected output).

### Ferrite supply filters (FB1/FB2/FB3, 600Ω@100MHz)
The two isolated DMX DC-DCs are the noisy switchers on the board. Ferrites form a small
filter around them so their switching racket stays local instead of riding out onto the +5V
rail or down the DMX cable:

- **FB1** on +5V feeding both B0505S inputs (with C21/C26 as the input bulk).
- **FB2** on the DMX1 isolated rail (VISO) feeding the transceiver, with the 10µF bulk on the
  DC-DC side and the 100nF decoupling on the driver side, so it's a proper input-bead /
  output-bead pair around each isolating supply.
- **FB3** same thing for DMX2.

LCSC C139168. Low DCR so they don't hurt the power budget.

### Conformal coating (assembly note, no part)
For installs that see humidity, dust, or condensation, spec an acrylic or polyurethane
conformal coat on the assembled board. Mask the connectors and the magjack so they still
mate. This is a manufacturing step, not a BOM line, but it's the cheapest thing you can do
for a board that lives in a damp basement or a truck.

## Grounding & shielding (metal enclosure)

If you put LuxDMX in a metal box, one rule sorts out almost everything: **bond the digital
ground to the chassis, keep the isolated DMX grounds off it.**

How the board is wired:
- Board GND is a solid inner plane.
- USB shield and the Ethernet (RJ45) shield/posts go to board GND.
- The DMX shells and pin-1 commons go to GNDISO / GNDISO2 (two *separate* isolated grounds).
- The 4 mounting holes are **plated and tied to board GND** (MountingHole_3.2mm_M3_Pad on the GND
  net), so screwing the board to metal standoffs bonds the digital ground to the chassis at four
  points.

**Mounting holes -> chassis (do this).** Multi-point bonding at all 4 corners is the big EMC win:
the case becomes a shield referenced to your ground, and the common-mode currents from Ethernet,
USB and the switchers return to chassis locally instead of looping the board. Use all four, not a
single point. Single-point grounding is a low-frequency idea and makes this worse (the noise here is
HF: 100M Ethernet, the DC-DCs).

**Shields: connect the digital ones, isolate the DMX ones.** USB shield + Ethernet shield + board
GND + chassis are one low-impedance system (they're already tied to board GND; the plated holes
finish it to chassis). The DMX shells (GNDISO/GNDISO2) stay separate.

**Don't clamp the DMX shells to chassis.** If a metal XLR bolts into the metal panel, its shell
(GNDISO on the board) bonds to chassis, which (a) kills the DMX isolation and (b) shorts the two
universes together through the case. Use isolating XLR mounting (Neutrik D-series isolated, shoulder
washers, or a slot so the PCB-mount shell doesn't touch the panel).

**Soft-ground (the option we left off).** A fully floating DMX shield is a small antenna, so the
pro move is a *soft ground*: ~1nF + ~1MΩ from each GNDISO to chassis. DC-isolated (loops stay
broken), HF-grounded (the shield gets a return), and the resistor bleeds ESD. We evaluated fitting
it (C30/C31 + R20/R21) but did **not** populate it: on this tightly-packed board the bridge has to
cross the 4mm isolation void right at the congested PS1/PS2 barrier, which either pushes the void
into adjacent board-GND parts or strands the barrier GND/+3V3 routing. If the layout is ever
loosened (or you don't need both universes isolated from each other), add it across the B0505S
barrier with a rule-area clearance exemption. Until then the shield is referenced at the console end
plus the isolating XLR mount.

**Ethernet:** the magjack already isolates (1500V). Its cable-side shield wants chassis, ideally via
a Bob-Smith network (75Ω + 1nF/2kV) if the part doesn't integrate one. Today the shield posts go to
board GND, which is fine once board GND is bonded to chassis.

The "great EMC" checklist: solid GND plane (have it), decoupling at the pins / short loops (have it),
CM chokes + ferrites on the cabled I/O (added above), board GND bonded to chassis at all 4 holes
(done), I/O shields to chassis at entry, DMX domain floating vs chassis (isolating XLR mount).

## What this does NOT do

- It's not a lightning arrestor. Direct strikes on a long DMX run are beyond what a board-level
  TVS handles; that's an installation/earthing problem.
- The PoE isolation is functional, not certified reinforced (the VPOE trace runs over the inner
  GND plane). See the PoE note in VALIDATION.md.
- No reverse-polarity part was added because there's no reverse-polarity path: USB-C is keyed
  and PoE comes in rectified through the magjack.

## Where the parts live on the PCB

Isolated parts stay inside their DMX island (>=4mm from board ground, same rule as the XLR):
L2 + FB2 in the DMX-OUT A island, L3 + FB3 in DMX-OUT B. The board-ground parts stay out of
the islands: U8 + F1 next to the USB-C inlet, D11 near the buck/OR, FB1 + C21 + C26 on the
B0505S primary side just left of the islands.

Re-run after any placement change:
```
"<KiCad>/bin/python" rebuild_iso.py && python escape_connectors.py && python autoroute_fr2.py \
  && python cleanup_pads.py && python tighten_poe_void.py
```
