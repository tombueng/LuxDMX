#!/usr/bin/env python3
"""Stretch a fine-pitch SMD land outwards so a soldering iron can reach it.

The pixel buffer is a 74AHCT541 in SOIC-20W, and there is nothing bigger to move it to: every
20-pin SMD package in the library is 1.27 mm pitch, and the only wider-pitch option is DIP-20
through-hole, which is where this part started and where it cannot go back to, because it sits
under a module on a 2.54 mm standoff.

What is left is the land. A stock SOIC pad reaches 1.9 mm past the body, which is enough for a
stencil and not much for an iron: the tip has to sit on the pad without touching the plastic,
and there is no room to feed solder from the side. Lengthening each pad outwards gives the tip
somewhere to land clear of the body. Nothing else changes - same part, same pitch, same
reflow - so this costs only board area.

The pads keep their centres' pitch and only grow away from the body, which is the direction
with room. Pad 1 stays identifiable because only the copper changes, not the silk.

Anything this moves invalidates the routing next to it, so re-route afterwards.

Run:  python tools/handsolder_lands.py [--ref 74AHCT541] [--extend 0.80] [--remove]
"""
import os
import sys

import pcbnew

DEFAULT_REF = "541"     # substring of the reference designator
EXTEND = 0.80           # how much further out each pad reaches
MAX_PITCH = 1.30        # only fine-pitch parts; wide-pitch lands are fine as they are


def _project_dir():
    d = os.path.dirname(os.path.abspath(__file__))
    for _ in range(3):
        if os.path.exists(os.path.join(d, "luxdmx-carrier.kicad_pcb")):
            return d
        d = os.path.dirname(d)
    return os.path.dirname(os.path.abspath(__file__))


BOARD = os.path.join(_project_dir(), "luxdmx-carrier.kicad_pcb")


def main():
    ref = sys.argv[sys.argv.index("--ref") + 1] if "--ref" in sys.argv else DEFAULT_REF
    ext = float(sys.argv[sys.argv.index("--extend") + 1]) if "--extend" in sys.argv else EXTEND
    if "--remove" in sys.argv:
        ext = -ext

    b = pcbnew.LoadBoard(BOARD)
    fps = [f for f in b.GetFootprints() if ref in f.GetReference()]
    if not fps:
        sys.exit(f"kein Footprint mit {ref!r} im Referenznamen")

    done = 0
    for f in fps:
        pads = list(f.Pads())
        # which way is "out": the pads sit in two rows, so the sign of the local coordinate
        # that separates the rows is the direction each pad has to grow in
        rel = [(p, p.GetFPRelativePosition()) for p in pads]
        xs = [pcbnew.ToMM(q.x) for _p, q in rel]
        ys = [pcbnew.ToMM(q.y) for _p, q in rel]
        # Which axis separates the rows: the one the pads take only a couple of values on.
        # Comparing the two extents instead reads a SOIC-20W backwards, because 9.3 mm of row
        # separation is less than 11.4 mm of pins along the row.
        rows_in_x = len({round(v, 2) for v in xs}) < len({round(v, 2) for v in ys})
        along = sorted(ys if rows_in_x else xs)
        pitch = min((b2 - a for a, b2 in zip(along, along[1:]) if b2 - a > 0.01), default=9.9)
        if pitch > MAX_PITCH:
            print(f"  {f.GetReference()}: Raster {pitch:.2f} mm, das reicht schon, "
                  f"nicht angefasst")
            continue

        for p, q in rel:
            cx, cy = pcbnew.ToMM(q.x), pcbnew.ToMM(q.y)
            w, h = pcbnew.ToMM(p.GetSizeX()), pcbnew.ToMM(p.GetSizeY())
            if rows_in_x:
                s = 1.0 if cx > 0 else -1.0
                p.SetSize(pcbnew.VECTOR2I(pcbnew.FromMM(w + ext), pcbnew.FromMM(h)))
                p.SetFPRelativePosition(pcbnew.VECTOR2I(
                    pcbnew.FromMM(cx + s * ext / 2), pcbnew.FromMM(cy)))
            else:
                s = 1.0 if cy > 0 else -1.0
                p.SetSize(pcbnew.VECTOR2I(pcbnew.FromMM(w), pcbnew.FromMM(h + ext)))
                p.SetFPRelativePosition(pcbnew.VECTOR2I(
                    pcbnew.FromMM(cx), pcbnew.FromMM(cy + s * ext / 2)))
            done += 1
        p0 = pads[0]
        print(f"  {f.GetReference()}: {len(pads)} Pads, Raster {pitch:.2f} mm, "
              f"jetzt {pcbnew.ToMM(p0.GetSizeX()):.2f} x {pcbnew.ToMM(p0.GetSizeY()):.2f} mm, "
              f"{abs(ext):.2f} mm {'laenger' if ext > 0 else 'kuerzer'} nach aussen")

    pcbnew.SaveBoard(BOARD, b)
    print(f"{done} Pads geaendert - das Routing daneben ist damit hinfaellig, neu routen")
    return 0


if __name__ == "__main__":
    sys.exit(main())
