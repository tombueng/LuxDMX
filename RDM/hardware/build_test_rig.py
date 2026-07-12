#!/usr/bin/env python
"""DMX/RDM bench test-rig carrier PCB - part + netlist generator (pcbnew, KiCad 10).

Loads every module socket + passive from the design brief (TEST_RIG_PCB.md), assigns
all nets, and drops the parts into a tidy STAGING grid - unplaced and unrouted on
purpose. You do the placement and routing in KiCad; the ratsnest shows every
connection so you can't miswire it.

Reduced part set (per user): NO external-5V input, NO LEDs, NO decoupling caps,
NO 120R termination, NO XLR, NO TVS. Kept: the module sockets, both MAX485s
(cross-wired), the W5500, the EN / 5V-source / W5500-3V3 jumpers, the bias +
ADC-divider resistors (THT leaded, hand-swappable), the measurement + logic-analyzer
headers, and a 3-pin screw terminal (A / B / GND) for the DMX bus breakout.

Run with KiCad's bundled python:
    "/c/Program Files/KiCad/10.0/bin/python.exe" build_test_rig.py
-> writes test_rig.kicad_pcb (+ test_rig.kicad_pro + test_rig_netlist.txt).
"""
import os, json, pcbnew
from pcbnew import FromMM as MM, VECTOR2I as V

HERE = os.path.dirname(os.path.abspath(__file__))
BOARD = os.path.join(HERE, "test_rig.kicad_pcb")
PRO   = os.path.join(HERE, "test_rig.kicad_pro")
NETDOC = os.path.join(HERE, "test_rig_netlist.txt")
FPDIR = r"C:\Program Files\KiCad\10.0\share\kicad\footprints"

NC = None  # a pad that stays unconnected (module pin we don't use)

PS  = "Connector_PinSocket_2.54mm"      # female headers (module sockets)
PH  = "Connector_PinHeader_2.54mm"      # male pin headers (jumpers / meas / LA)
RES = "Resistor_THT"
R_AXIAL = (RES, "R_Axial_DIN0207_L6.3mm_D2.5mm_P7.62mm_Horizontal")  # leaded, hand-swappable

COMPONENTS = {}   # ref -> dict(lib, fp, pads{pad:net}, value)

def add(ref, lib, fp, pads, value=None):
    COMPONENTS[ref] = dict(lib=lib, fp=fp, pads=pads, value=value or ref)

# ==== SIM node: RP2350 Pico Plus 2 W ======================================
# Standard Pico 40-pin. Left socket = physical pins 1..20 (pad k = pin k, top->bottom).
add("J_PICOA", PS, "PinSocket_1x20_P2.54mm_Vertical", {
    1:"SIM_RX",   # pin1  GP0  -> MAX485#1 RO/RXD  (MCU RX)
    2:"SIM_TX",   # pin2  GP1  -> MAX485#1 DI/TXD  (MCU TX)
    3:"GND",      # pin3  GND
    4:"SIM_EN",   # pin4  GP2  -> MAX485#1 DE+/RE  (direct)
    8:"GND", 13:"GND", 18:"GND",
}, value="PIMORONI RP2350 SIM (L)")
# Right socket = physical pins 21..40; pad k maps to pin (41-k) so pad1 == pin40 (top).
add("J_PICOB", PS, "PinSocket_1x20_P2.54mm_Vertical", {
    # pin40 VBUS -> LEAVE NC; Pico sources/sinks 5V via VSYS through its onboard diode
    2:"+5V",        # pin39 VSYS <-> shared 5V rail
    3:"GND",        # pin38 GND
    # pad4 = pin37 3V3_EN -> LEAVE NC (regulator enable; loading it browns out 3V3) - brief 5.4
    5:"+3V3_SIM",   # pin36 3V3(OUT) -> sim 3.3V rail (transceiver VCC + bias top)
    8:"GND",        # pin33 AGND
    9:"SIM_A1",     # pin32 GP27/A1 -> BUS_A analog probe tap
    10:"SIM_A0",    # pin31 GP26/A0 -> BUS_B analog probe tap
    13:"GND",       # pin28 GND
    18:"GND",       # pin23 GND
}, value="PIMORONI RP2350 SIM (R)")

# ==== SIM transceiver: MAX485 #1 (RXD/TXD module, cross-wired) =============
# pin order runs bottom->top on the physical module: pad1 is GND (top of socket), pad5 EN.
add("J_485A_L", PS, "PinSocket_1x05_P2.54mm_Vertical", {
    1:"GND", 2:"SIM_TX", 3:"SIM_RX", 4:"+3V3_SIM", 5:"SIM_EN",
}, value="MAX485 SIM (L)")
add("J_485A_R", PS, "PinSocket_1x05_P2.54mm_Vertical", {
    1:NC, 2:"BUS_B", 3:"BUS_A", 4:"GND", 5:NC,
}, value="MAX485 SIM A/B (R)")

# ==== S3 transceiver: MAX485 #2 ===========================================
add("J_485B_R", PS, "PinSocket_1x05_P2.54mm_Vertical", {
    1:NC, 2:"BUS_B", 3:"BUS_A", 4:"GND", 5:NC,
}, value="MAX485 S3 A/B (R)")
add("J_485B_L", PS, "PinSocket_1x05_P2.54mm_Vertical", {
    1:"GND", 2:"S3_DMX_TX", 3:"S3_DMX_RX", 4:"+3V3_S3", 5:"S3_DMX_EN",
}, value="MAX485 S3 (L)")

# ==== DUT node: ESP32-S3-DevKitC-1 ========================================
# Left header J1 (all signals we use). pad k = J1 pin k (top->bottom).
add("J_S3A", PS, "PinSocket_1x22_P2.54mm_Vertical", {
    1:"+3V3_S3", 2:"+3V3_S3",             # J1.1/1.2 3V3
    10:"S3_DMX_TX",   # J1.10 GPIO17 DMX TX -> MAX485#2 DI/TXD
    11:"S3_DMX_RX",   # J1.11 GPIO18 DMX RX <- MAX485#2 RO/RXD
    12:"S3_DMX_EN",   # J1.12 GPIO8  DMX DE+RE (direct)
    15:"ETH_RST",     # J1.15 GPIO9  W5500 RST
    16:"ETH_CS",      # J1.16 GPIO10 W5500 SCS
    17:"ETH_MOSI",    # J1.17 GPIO11 W5500 MOSI
    18:"ETH_SCLK",    # J1.18 GPIO12 W5500 SCLK
    19:"ETH_MISO",    # J1.19 GPIO13 W5500 MISO
    20:"ETH_INT",     # J1.20 GPIO14 W5500 INT
    21:"+5V",         # J1.21 5V  <-> shared 5V rail
    22:"GND",         # J1.22 GND
}, value="ESP32-S3-DEVKITC DUT (J1)")
add("J_S3B", PS, "PinSocket_1x22_P2.54mm_Vertical", {
    1:"GND", 21:"GND", 22:"GND",          # J3.1 / J3.21 / J3.22 GND
}, value="ESP32-S3-DEVKITC DUT (J3)")

# ==== W5500 Ethernet module (2x5) =========================================
# Two module rows land in the two socket columns; rows flipped L<->R vs the first cut.
# Odd pads (col A): 3V3 MISO MOSI SCS SCLK ; even pads (col B): 5V GND RST INT NC.
# Module 3V3 pin (pad1) left NC: powered from its 5V pin (regulated module, brief section 1).
add("J_W5500", PS, "PinSocket_2x05_P2.54mm_Vertical", {
    1:NC, 3:"ETH_MISO", 5:"ETH_MOSI", 7:"ETH_CS", 9:"ETH_SCLK",   # col A: 3V3(NC)/MISO/MOSI/SCS/SCLK
    2:"+5V", 4:"GND", 6:"ETH_RST", 8:"ETH_INT", 10:NC,            # col B: 5V/GND/RST/INT/NC
}, value="W5500 ETHERNET")

# ==== Fail-safe bias (ONE place, sim node) - THT leaded, hand-tuned ~270R ==
add("Rb1", *R_AXIAL, {1:"BUS_A", 2:"+3V3_SIM"}, value="BIAS 270R A->3V3")
add("Rb2", *R_AXIAL, {1:"BUS_B", 2:"GND"},      value="BIAS 270R B->GND")

# ==== Analog-probe dividers (2:1, THT leaded 10k), sim ADC ================
# BUS_A -10k- A1 -10k- GND ; BUS_B -10k- A0 -10k- GND  (brief section 2)
add("Rd1", *R_AXIAL, {1:"BUS_A", 2:"SIM_A1"}, value="ADC-DIV 10k A->A1")
add("Rd2", *R_AXIAL, {1:"SIM_A1", 2:"GND"},   value="ADC-DIV 10k A1->GND")
add("Rd3", *R_AXIAL, {1:"BUS_B", 2:"SIM_A0"}, value="ADC-DIV 10k B->A0")
add("Rd4", *R_AXIAL, {1:"SIM_A0", 2:"GND"},   value="ADC-DIV 10k A0->GND")

# ==== Measurement header (required): A B 3V3 GND 5V TX RX ==================
add("J_MEAS", PH, "PinHeader_1x07_P2.54mm_Vertical", {
    1:"BUS_A", 2:"BUS_B", 3:"+3V3_SIM", 4:"GND", 5:"+5V", 6:"SIM_TX", 7:"SIM_RX",
}, value="MEAS: A B 3V3 GND 5V TX RX")

# ==== Logic-analyzer header (2x8): signal row + full GND row ==============
add("J_LA", PH, "PinHeader_2x08_P2.54mm_Vertical", {
    1:"BUS_A",      2:"GND",
    3:"BUS_B",      4:"GND",
    5:"SIM_TX",     6:"GND",
    7:"SIM_RX",     8:"GND",
    9:"SIM_EN",     10:"GND",
    11:"S3_DMX_TX", 12:"GND",
    13:"S3_DMX_RX", 14:"GND",
    15:"S3_DMX_EN", 16:"GND",
}, value="LOGIC-ANALYZER HDR")

# ==== DMX bus breakout: 3-pin screw terminal (A / B / GND) ================
add("J_TERM", "TerminalBlock_Phoenix",
    "TerminalBlock_Phoenix_MKDS-1,5-3_1x03_P5.00mm_Horizontal",
    {1:"BUS_A", 2:"BUS_B", 3:"GND"}, value="DMX A/B/GND (screw)")

# ---------------------------------------------------------------------------
# Staging grid: parts grouped by function in rows, spaced by their body extent.
# This is a holding area to place from, NOT a designed layout.
# ---------------------------------------------------------------------------
GROUPS = [
    ("modules",      ["J_PICOA", "J_PICOB", "J_S3A", "J_S3B"]),
    ("transceivers", ["J_485A_L", "J_485A_R", "J_485B_L", "J_485B_R", "J_W5500"]),
    ("resistors",    ["Rb1", "Rb2", "Rd1", "Rd2", "Rd3", "Rd4"]),
    ("headers",      ["J_MEAS", "J_LA", "J_TERM"]),
]
# A module's two sockets MUST sit at the module's real header row spacing (an integer
# number of 0.1" holes) or the module can't seat. partner -> (anchor, row spacing mm).
# Same footprint on both halves, so the partner is just the anchor shifted in X.
PAIR = {
    "J_PICOB": ("J_PICOA", 17.78),   # Pico Plus 2W: 7 holes
    "J_S3B":   ("J_S3A", 22.86),     # ESP32-S3-DevKitC-1: 9 holes
    "J_485A_R": ("J_485A_L", 15.24), # MAX485 module: 6 holes
    "J_485B_R": ("J_485B_L", 15.24),
}
GAP = 11.0         # gap between staged parts (room for the function labels)
ROW_GAP = 16.0     # gap between staged rows (room for the label under each part)


def pad_extent(fp):
    xs, ys, r = [], [], 0
    for p in fp.Pads():
        pos = p.GetPosition()
        xs.append(pcbnew.ToMM(pos.x)); ys.append(pcbnew.ToMM(pos.y))
        r = max(r, pcbnew.ToMM(p.GetSize().x), pcbnew.ToMM(p.GetSize().y))
    return min(xs), min(ys), max(xs), max(ys), r


def main():
    b = pcbnew.BOARD()
    b.SetCopperLayerCount(2)
    try:
        dc = b.GetDesignSettings().m_NetSettings.GetDefaultNetclass()
        dc.SetTrackWidth(MM(0.4)); dc.SetClearance(MM(0.25))
        dc.SetViaDiameter(MM(0.8)); dc.SetViaDrill(MM(0.4))
    except Exception as e:
        print("warn: could not set default netclass:", e)

    nets = {}
    def net(name):
        if name is None:
            return None
        if name not in nets:
            n = pcbnew.NETINFO_ITEM(b, name); b.Add(n); nets[name] = n
        return nets[name]

    fps = {}
    for ref, c in COMPONENTS.items():
        fp = pcbnew.FootprintLoad(FPDIR + "\\" + c["lib"] + ".pretty", c["fp"])
        if fp is None:
            raise SystemExit(f"footprint not found: {c['lib']}:{c['fp']}")
        fp.SetReference(ref); fp.SetValue(c["value"])
        b.Add(fp)
        fp.Reference().SetTextSize(V(MM(0.8), MM(0.8)))
        fp.Reference().SetTextThickness(MM(0.12))
        # function label: Value field, shown on the SILK layer so it moves with the part
        v = fp.Value()
        v.SetVisible(True)
        v.SetLayer(pcbnew.F_SilkS)
        v.SetTextSize(V(MM(1.0), MM(1.0)))
        v.SetTextThickness(MM(0.15))
        want = {str(k): v for k, v in c["pads"].items()}
        for pad in fp.Pads():
            if pad.GetNumber() in want:
                n = net(want[pad.GetNumber()])
                if n is not None:
                    pad.SetNet(n)
        fps[ref] = fp

    # lay out the staging grid
    pos = {}       # ref -> footprint origin (board coords), for pairing
    y = 15.0
    for _, refs in GROUPS:
        x = 15.0
        rowh = 0.0
        for ref in refs:
            fp = fps[ref]
            fp.SetPosition(V(0, 0))
            minx, miny, maxx, maxy, r = pad_extent(fp)
            if ref in PAIR:                       # partner: lock to the anchor's row spacing
                anchor, sp = PAIR[ref]
                ap = pos[anchor]
                fp.SetPosition(V(ap.x + MM(sp), ap.y))
                x = pcbnew.ToMM(fp.GetPosition().x) + maxx + r + GAP
            else:
                fp.SetPosition(V(MM(x - minx + r), MM(y - miny + r)))
                x += (maxx - minx) + 2 * r + GAP
            pos[ref] = fp.GetPosition()
            # drop the function label (Value on silk) centered just under the part
            axmin, aymin, axmax, aymax, ar = pad_extent(fp)
            fp.Value().SetPosition(V(MM((axmin + axmax) / 2), MM(aymax + ar + 1.6)))
            rowh = max(rowh, (maxy - miny) + 2 * r)
        y += rowh + ROW_GAP

    # loose canvas outline around everything (just so it opens as a board; resize freely)
    xs, ys = [], []
    for fp in fps.values():
        for pad in fp.Pads():
            p = pad.GetPosition()
            xs.append(pcbnew.ToMM(p.x)); ys.append(pcbnew.ToMM(p.y))
    m = 10.0
    rect = pcbnew.PCB_SHAPE(b)
    rect.SetShape(pcbnew.SHAPE_T_RECT)
    rect.SetStart(V(MM(min(xs) - m), MM(min(ys) - m)))
    rect.SetEnd(V(MM(max(xs) + m), MM(max(ys) + m)))
    rect.SetLayer(pcbnew.Edge_Cuts)
    rect.SetWidth(MM(0.15))
    b.Add(rect)

    t = pcbnew.PCB_TEXT(b)
    t.SetText("DMX/RDM test-rig - parts staged (unplaced/unrouted). CROSS-WIRE: module RXD->MCU RX, TXD->MCU TX")
    t.SetLayer(pcbnew.F_SilkS)
    t.SetPosition(V(MM(min(xs) - m + 3), MM(max(ys) + m - 3)))
    t.SetTextSize(V(MM(1.4), MM(1.4)))
    t.SetTextThickness(MM(0.2))
    b.Add(t)

    pcbnew.SaveBoard(BOARD, b)
    print(f"saved {BOARD}: {len(fps)} footprints, {len(nets)} nets (staged, unrouted)")

    if not os.path.exists(PRO):
        with open(PRO, "w", encoding="utf-8") as f:
            json.dump({"board": {"design_settings": {}}, "meta": {"version": 1},
                       "sheets": [], "libraries": {}}, f, indent=2)
        print(f"wrote {PRO}")

    # human-readable net list (source of truth for hand-placing / routing)
    from collections import defaultdict
    d = defaultdict(list)
    for ref, c in COMPONENTS.items():
        for pad, netname in c["pads"].items():
            if netname:
                d[netname].append(f"{ref}.{pad}")
    with open(NETDOC, "w", encoding="utf-8") as f:
        f.write("DMX/RDM test-rig - net list (ref.pad per net)\n")
        f.write("=" * 60 + "\n")
        for name in sorted(d):
            f.write(f"{name:12s} ({len(d[name]):2d})  {'  '.join(d[name])}\n")
    print(f"wrote {NETDOC}")


if __name__ == "__main__":
    main()
