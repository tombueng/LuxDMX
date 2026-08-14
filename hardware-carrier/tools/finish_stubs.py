#!/usr/bin/env python3
"""Connect the solder-bridge pads that the autorouter cannot reach.

The two bridge pads sit 0.3 mm apart between the polyfuse's through-holes. The Power class
routes at 1.0 mm with 0.3 mm clearance, and there is simply no room for that in the gap, so
Freerouting leaves both pads floating. They only need a 2 mm stub each, on the back, to the
through-hole of their own net in the same footprint, as wide as the gap allows.

Done here rather than by loosening the Power class, because widening the exception to the
whole net would thin down every power stub on the board to fix two pads.

Checks its own clearance to foreign-net copper before it writes anything.

Run:  python hardware-carrier/finish_stubs.py [--dry-run]
"""
import os
import sys

import pcbnew

def _project_dir():
    """The project directory, whether this script sits in it or in tools/ beside it.

    The tooling is deliberately kept out of the git repo (see .gitignore), so it lives one
    level down in tools/. Everything it reads and writes still belongs next to the board."""
    d = os.path.dirname(os.path.abspath(__file__))
    for _ in range(3):
        if os.path.exists(os.path.join(d, "luxdmx-carrier.kicad_pcb")) or \
           os.path.exists(os.path.join(d, "modules.json")):
            return d
        d = os.path.dirname(d)
    return os.path.dirname(os.path.abspath(__file__))


HERE = _project_dir()
BOARD = os.path.join(HERE, "luxdmx-carrier.kicad_pcb")
WIDTH = 0.35          # floor: below this the stub is not worth setting
MIN_CLEAR = 0.30      # the Power netclass clearance, not a hair less


def seg_box_gap(a, bpt, box, half):
    """Distance from segment a->bpt (half-width `half`) to an axis-aligned box."""
    best = 1e9
    steps = 40
    for i in range(steps + 1):
        t = i / steps
        x = a[0] + (bpt[0] - a[0]) * t
        y = a[1] + (bpt[1] - a[1]) * t
        dx = max(box[0] - x, 0, x - box[2])
        dy = max(box[1] - y, 0, y - box[3])
        best = min(best, (dx * dx + dy * dy) ** 0.5)
    return best - half


def pad_box(p):
    q, s = p.GetPosition(), p.GetSize()
    x, y = pcbnew.ToMM(q.x), pcbnew.ToMM(q.y)
    w, h = pcbnew.ToMM(s.x) / 2, pcbnew.ToMM(s.y) / 2
    return [x - w, y - h, x + w, y + h]


def main():
    dry = "--dry-run" in sys.argv
    board = pcbnew.LoadBoard(BOARD)

    fp = next((f for f in board.GetFootprints()
               if f.GetFPIDAsString().endswith("polyfuse-dual-pitch")), None)
    if fp is None:
        print("Polyfuse-Footprint nicht auf dem Board")
        return 1

    smd = [p for p in fp.Pads() if p.GetDrillSizeX() == 0]
    tht = [p for p in fp.Pads() if p.GetDrillSizeX() > 0]
    print(f"{len(smd)} Bruecken-Pads, {len(tht)} Loecher")

    added = 0
    for p in smd:
        net = p.GetNetname()
        mates = [t for t in tht if t.GetNetname() == net]
        if not mates:
            print(f"  Pad {p.GetNumber()} [{net}]: kein Loch im selben Netz")
            continue
        a = (pcbnew.ToMM(p.GetPosition().x), pcbnew.ToMM(p.GetPosition().y))
        mate = min(mates, key=lambda t: (pcbnew.ToMM(t.GetPosition().x) - a[0]) ** 2
                                        + (pcbnew.ToMM(t.GetPosition().y) - a[1]) ** 2)
        bpt = (pcbnew.ToMM(mate.GetPosition().x), pcbnew.ToMM(mate.GetPosition().y))

        # If the land already reaches its own hole there is nothing to stub. That is now the
        # normal case: the bridge pads were widened until they overlap, precisely so that the
        # bypass is not limited by a track squeezed past the neighbouring pad.
        pa, pb = pad_box(p), pad_box(mate)
        if pa[0] <= pb[2] and pa[2] >= pb[0] and pa[1] <= pb[3] and pa[3] >= pb[1]:
            print(f"  Pad {p.GetNumber()} [{net:9s}] beruehrt sein Loch bereits, kein Stub noetig")
            continue

        # Straight across the band both pads share, not corner to corner. The diagonal was
        # the obvious line and it is the wrong one: it leans towards the neighbouring bridge
        # pad, which sits 0.30 mm away, so the clearance runs out at a width that carries
        # nothing. Level with the pads, the run keeps its distance for its whole length.
        pa, pb = pad_box(p), pad_box(mate)
        ylo, yhi = max(pa[1], pb[1]), min(pa[3], pb[3])
        cap = 9.9
        if yhi - ylo > 0.1:
            a = (a[0], (ylo + yhi) / 2)
            bpt = (bpt[0], (ylo + yhi) / 2)
            cap = yhi - ylo                    # stay inside both pads
        length = ((bpt[0] - a[0]) ** 2 + (bpt[1] - a[1]) ** 2) ** 0.5

        # Widest that still clears. This used to be a fixed 0.35 mm on the reasoning that the
        # pour carries the current, and there is no pour on this rail any more: the supply
        # runs as tracks. That left the solder-bridge bypass, the option you use INSTEAD of
        # the fuse, good for 1.6 A while the fuse path next to it does 10. Measured, not
        # assumed.
        def clearance(w):
            worst = (99.0, None)
            for g in board.GetFootprints():
                for q in g.Pads():
                    if q.GetNetname() == net or not q.IsOnLayer(pcbnew.B_Cu):
                        continue
                    d = seg_box_gap(a, bpt, pad_box(q), w / 2)
                    if d < worst[0]:
                        worst = (d, f"{g.GetReference()[:20]} Pad {q.GetNumber()}")
            return worst

        width, worst = WIDTH, clearance(WIDTH)
        w = cap
        while w >= WIDTH:
            c = clearance(w)
            if c[0] >= MIN_CLEAR:
                width, worst = w, c
                break
            w -= 0.05
        print(f"  Pad {p.GetNumber()} [{net:9s}] -> Loch bei ({bpt[0]:.2f},{bpt[1]:.2f}), "
              f"{length:.2f} mm, {width:.2f} mm breit, "
              f"Abstand zu Fremdnetz {worst[0]:.2f} mm ({worst[1]})")
        if worst[0] < MIN_CLEAR:
            print("     ZU ENG, nicht gesetzt")
            continue

        if not dry:
            t = pcbnew.PCB_TRACK(board)
            t.SetStart(pcbnew.VECTOR2I(pcbnew.FromMM(a[0]), pcbnew.FromMM(a[1])))
            t.SetEnd(pcbnew.VECTOR2I(pcbnew.FromMM(bpt[0]), pcbnew.FromMM(bpt[1])))
            t.SetWidth(pcbnew.FromMM(width))
            t.SetLayer(pcbnew.B_Cu)
            t.SetNet(p.GetNet())
            t.SetLocked(True)          # so a re-route does not rip it out again
            board.Add(t)
        added += 1

    if not dry and added:
        pcbnew.SaveBoard(BOARD, board)
        print(f"\n{added} Stubs gesetzt (gesperrt), gespeichert")
    return 0


if __name__ == "__main__":
    sys.exit(main())
