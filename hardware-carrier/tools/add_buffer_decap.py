#!/usr/bin/env python3
"""Put a 100 nF decoupling cap on the 74AHCT541's supply pins (rev 1.2).

The buffer sits on the back with VCC (pin 20) and GND (pin 19) next to each other at the
lower right corner. Until rev 1.1 a GND track looped from pin 19 round pin 20 to the GND
bar below, which boxed pin 20 in and left no place for a cap. That loop is redundant: pin 19
keeps its stub into the GND pour and the bar keeps its end in the pour. So:

  - the loop's last three segments (down past pin 20 and back to the bar) go,
  - a 1206 100 nF (same part as the other 100nF, LCSC C24497) stands upright right of
    pin 20, +5V pad on top, GND pad below,
  - pin 20 gets a 0.8 mm track straight across to the +5V pad,
  - the GND pad gets a 0.8 mm track to the existing GND via at (110.5, 104.0), and the
    GND bar end gets one to the same via,
  - pin 19 (OE2, tied low) keeps its stub, but the pour pocket it ends in is cut off once
    the +5V track crosses below it. So the stub carries on as a 0.4 mm track right of the
    cap (0.25 mm to the cap's +5V pad, 0.25 mm to the 330R's pad) down into the GND pad.
    Without it OE2 floats; net_islands.py showed the 6 mm2 pocket.

Every move is by exact coordinate; DRC and the connectivity gate run afterwards.
Idempotent: does nothing once the cap is there.

Run:  python tools/add_buffer_decap.py
"""
import os
import sys

import pcbnew

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BOARD = os.path.join(HERE, "luxdmx-carrier.kicad_pcb")
REF = "100nF buffer"
CAP = (112.1, 102.5)                    # centre, pads 2.6 mm apart along y
VPAD, GPAD = (112.1, 101.2), (112.1, 103.8)
PIN20 = (109.33, 100.86)
VIA = (110.5, 104.0)
BAR_END = (110.42, 102.62)
STUB_END = (111.30, 99.43)
LANE_X = 113.45
LOOP = [((111.30, 99.43), (111.57, 99.70)),
        ((111.57, 99.70), (111.57, 101.47)),
        ((111.57, 101.47), (110.42, 102.62))]

P = lambda xy: pcbnew.VECTOR2I(pcbnew.FromMM(xy[0]), pcbnew.FromMM(xy[1]))
mm = pcbnew.ToMM


def near(a, b, tol=0.01):
    return abs(mm(a.x) - b[0]) < tol and abs(mm(a.y) - b[1]) < tol


def track(b, a, c, w, net):
    t = pcbnew.PCB_TRACK(b)
    t.SetStart(P(a)); t.SetEnd(P(c)); t.SetWidth(pcbnew.FromMM(w))
    t.SetLayer(pcbnew.B_Cu); t.SetNet(net)
    b.Add(t)


def main():
    b = pcbnew.LoadBoard(BOARD)
    if any(f.GetReference() == REF for f in b.GetFootprints()):
        print("already there")
        return 0
    gnd, v5 = b.FindNet("GND"), b.FindNet("+5V")

    gone = []
    for t in list(b.GetTracks()):
        if t.Type() == pcbnew.PCB_TRACE_T and t.GetNetname() == "GND" and t.GetLayer() == pcbnew.B_Cu:
            for s, e in LOOP:
                if (near(t.GetStart(), s) and near(t.GetEnd(), e)) or (near(t.GetStart(), e) and near(t.GetEnd(), s)):
                    gone.append(t)
    if len(gone) != len(LOOP):
        print(f"expected {len(LOOP)} loop segments, found {len(gone)}: board not as expected")
        return 1
    for t in gone:
        b.Remove(t)

    # a copy of the 3V3 100nF already on the back: same lands, same 3D model, same side
    twin = [f for f in b.GetFootprints() if f.GetReference() == "100nF"][0]
    fp = pcbnew.FOOTPRINT(twin)
    fp.SetReference(REF); fp.SetValue("100nF")
    b.Add(fp)
    fp.SetPosition(P(CAP))
    # pad 1 (+5V) up, pad 2 (GND) down; find the rotation that does it
    for deg in (90, 270, 0, 180):
        fp.SetOrientationDegrees(deg)
        p1 = [p for p in fp.Pads() if p.GetNumber() == "1"][0]
        if near(p1.GetPosition(), VPAD, 0.05):
            break
    else:
        print("no rotation puts pad 1 on top")
        return 1
    for p in fp.Pads():
        p.SetNet(v5 if p.GetNumber() == "1" else gnd)
    fp.Value().SetVisible(False)
    fp.Reference().SetVisible(False)

    track(b, PIN20, VPAD, 0.8, v5)
    track(b, GPAD, VIA, 0.8, gnd)
    track(b, BAR_END, VIA, 1.0, gnd)
    track(b, STUB_END, (LANE_X, STUB_END[1]), 0.4, gnd)
    track(b, (LANE_X, STUB_END[1]), (LANE_X, GPAD[1]), 0.4, gnd)
    track(b, (LANE_X, GPAD[1]), GPAD, 0.4, gnd)

    pcbnew.ZONE_FILLER(b).Fill(b.Zones())
    pcbnew.SaveBoard(BOARD, b)
    print(f"cap at {CAP}, rot {fp.GetOrientationDegrees()}, loop segments removed: {len(gone)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
