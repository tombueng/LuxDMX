#!/usr/bin/env python3
"""Bring the polyfuse's solder bridge on the board in line with gen_polyfuse_dual.py (rev 1.2).

The library footprint now has each bridge strap under solder mask with only a 0.75 mm strip
either side of the 0.3 mm seam open, so the fuse's own fillets on the back cannot run across
the seam. Swapping the whole footprint would throw away its placement and silk tweaks, so
this changes the two bridge pads in place: the strap keeps its copper and loses B.Mask, and
a copy of it, BR_EXP wide and against the seam, is bare copper, and one mask-only
aperture spans both strips and the seam. Copper is
unchanged, so no clearance can change. Positions are read from the board, not typed in.
Idempotent.

Run:  python tools/bridge_mask.py
"""
import os
import sys

import pcbnew

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BOARD = os.path.join(HERE, "luxdmx-carrier.kicad_pcb")
FPID = "polyfuse-dual-pitch"
BR_EXP, BR_GAP = 0.75, 0.30
mm = pcbnew.ToMM


def main():
    b = pcbnew.LoadBoard(BOARD)
    fp = [f for f in b.GetFootprints() if f.GetFPIDAsString().endswith(FPID)]
    if len(fp) != 1:
        print(f"expected one {FPID}, found {len(fp)}")
        return 1
    fp = fp[0]
    smd = [p for p in fp.Pads() if p.GetAttribute() == pcbnew.PAD_ATTRIB_SMD]
    if len(smd) == 4:
        print("already masked")
        return 0
    if len(smd) != 2:
        print(f"expected 2 bridge pads, found {len(smd)}")
        return 1
    smd.sort(key=lambda p: p.GetPosition().x)
    left, right = smd
    seam = (left.GetBoundingBox().GetRight() + right.GetBoundingBox().GetLeft()) / 2
    seam_mm = mm(int(seam))
    gap = mm(right.GetBoundingBox().GetLeft() - left.GetBoundingBox().GetRight())
    if abs(gap - BR_GAP) > 0.02:
        print(f"seam is {gap:.3f} mm, expected {BR_GAP}")
        return 1
    strap = pcbnew.LSET(); strap.AddLayer(pcbnew.B_Cu)
    opened = pcbnew.LSET(); opened.AddLayer(pcbnew.B_Cu); opened.AddLayer(pcbnew.B_Mask)
    for pad, side in ((left, -1), (right, +1)):
        h = pad.GetSize().y
        cx = seam_mm + side * (BR_GAP / 2 + BR_EXP / 2)
        cy = mm(pad.GetPosition().y)
        new = pcbnew.PAD(pad)
        new.SetSize(pcbnew.VECTOR2I(pcbnew.FromMM(BR_EXP), h))
        new.SetPosition(pcbnew.VECTOR2I(pcbnew.FromMM(cx), pcbnew.FromMM(cy)))
        new.SetLayerSet(opened)
        pad.SetLayerSet(strap)
        fp.Add(new)
        print(f"pad {pad.GetNumber()}: strap under mask, opening {BR_EXP} x {mm(h):.2f} at ({cx:.3f}, {cy:.3f})")
    # one mask opening over both strips and the seam: an aperture pad on B.Mask only, so no
    # 0.3 mm mask dam stays in the seam (review round 6)
    ap = pcbnew.PAD(fp)
    ap.SetAttribute(pcbnew.PAD_ATTRIB_SMD)
    ap.SetShape(pcbnew.PAD_SHAPE_RECT)
    ap.SetNumber("")
    ap.SetSize(pcbnew.VECTOR2I(pcbnew.FromMM(2 * BR_EXP + BR_GAP), left.GetSize().y))
    ap.SetPosition(pcbnew.VECTOR2I(int(seam), left.GetPosition().y))
    mask = pcbnew.LSET(); mask.AddLayer(pcbnew.B_Mask)
    ap.SetLayerSet(mask)
    fp.Add(ap)
    # that opening spans V_PIX_IN and V_PIX on purpose, it is a solder jumper
    fp.SetAllowSolderMaskBridges(True)
    pcbnew.ZONE_FILLER(b).Fill(b.Zones())
    pcbnew.SaveBoard(BOARD, b)
    return 0


if __name__ == "__main__":
    sys.exit(main())
