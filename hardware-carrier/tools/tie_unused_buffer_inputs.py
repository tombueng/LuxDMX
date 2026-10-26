#!/usr/bin/env python3
"""Tie the pixel buffer's three unused inputs to GND.

The 74HCT541 has eight channels and the carrier uses five. Inputs A6, A7 and A8 (pins 7, 8, 9)
had no net at all, and a CMOS input left open sits wherever leakage puts it, often near the
switching threshold: extra supply current, and the unused outputs Y6..Y8 can oscillate. The
datasheets say it plainly: unused inputs go to VCC or GND.

Pin 10 is GND and sits right next to them, so the fix is one straight track down the pad row,
pin 7 to pin 10, on the side the buffer is mounted on. Nothing else runs between those pads
(the gaps are 0.67 mm), so the track touches no other net.

Idempotent: run it twice and the second run changes nothing. Refill the zones and run DRC
afterwards; this script only edits pads and adds the one track.

Run:  python tools/tie_unused_buffer_inputs.py
"""
import os
import sys

import pcbnew

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PCB = os.path.join(HERE, "luxdmx-carrier.kicad_pcb")
REF = "74AHCT541 pixel buffer"
UNUSED = ("7", "8", "9")
GND_PIN = "10"
WIDTH_MM = 0.40


def main():
    b = pcbnew.LoadBoard(PCB)
    fp = next((f for f in b.GetFootprints() if f.GetReference() == REF), None)
    if fp is None:
        print("footprint not found: " + REF)
        return 1
    gnd = b.FindNet("GND")
    pads = {p.GetNumber(): p for p in fp.Pads()}
    if pads[GND_PIN].GetNetname() != "GND":
        print("pin %s is %r, expected GND; not touching anything" % (GND_PIN, pads[GND_PIN].GetNetname()))
        return 1

    changed = 0
    for n in UNUSED:
        if pads[n].GetNetname() not in ("", "GND"):
            print("pin %s already carries %r; not touching anything" % (n, pads[n].GetNetname()))
            return 1
        if pads[n].GetNetname() != "GND":
            pads[n].SetNet(gnd)
            changed += 1

    layer = pcbnew.B_Cu if fp.IsFlipped() else pcbnew.F_Cu
    start = pads[UNUSED[0]].GetPosition()
    end = pads[GND_PIN].GetPosition()
    exists = any(t.GetClass() == "PCB_TRACK" and t.GetLayer() == layer and
                 {(t.GetStart().x, t.GetStart().y), (t.GetEnd().x, t.GetEnd().y)} ==
                 {(start.x, start.y), (end.x, end.y)}
                 for t in b.GetTracks())
    if not exists:
        t = pcbnew.PCB_TRACK(b)
        t.SetStart(start)
        t.SetEnd(end)
        t.SetLayer(layer)
        t.SetWidth(pcbnew.FromMM(WIDTH_MM))
        t.SetNet(gnd)
        t.SetLocked(True)
        b.Add(t)
        changed += 1

    if changed:
        pcbnew.SaveBoard(PCB, b)
    print("%d change(s); pins %s on GND, tied to pin %s with a %.2f mm track"
          % (changed, "/".join(UNUSED), GND_PIN, WIDTH_MM))
    return 0


if __name__ == "__main__":
    sys.exit(main())
