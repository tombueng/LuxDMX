#!/usr/bin/env python3
"""Swap one placed footprint for another, keeping everything the board cares about.

Used to turn the 74AHCT541's DIP-20 **socket** land into the DIP-20 **IC** land. Pads are
identical on both (pin 1 at the origin, 7.62 mm rows, 0.80 mm drill), only silk and courtyard
differ, so nothing that is already routed moves.

Position, orientation, side, per-pad nets and the hand-placed reference text all survive.
Refuses to run if the pad positions differ, which is the whole reason a swap can be safe.

Run:  python hardware-carrier/swap_footprint.py "<reference>" <lib-dir> <new-footprint>
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
TOL = 0.01


def pads_of(fp):
    return {p.GetNumber(): (round(pcbnew.ToMM(p.GetPosition().x - fp.GetPosition().x), 3),
                            round(pcbnew.ToMM(p.GetPosition().y - fp.GetPosition().y), 3))
            for p in fp.Pads()}


def main():
    if len(sys.argv) < 4:
        print(__doc__)
        return 1
    ref, lib, name = sys.argv[1], sys.argv[2], sys.argv[3]

    board = pcbnew.LoadBoard(BOARD)
    old = next((f for f in board.GetFootprints() if f.GetReference() == ref), None)
    if old is None:
        print(f"{ref!r} nicht auf dem Board")
        return 1

    new = pcbnew.FootprintLoad(lib, name)
    if new is None:
        print(f"{name} nicht in {lib}")
        return 1

    # Orient the candidate the way the placed one sits BEFORE comparing. Otherwise a part
    # that is simply rotated 90 degrees on the board reads as a completely different pinout.
    new.SetOrientationDegrees(old.GetOrientationDegrees())
    if old.IsFlipped():
        new.Flip(new.GetPosition(), pcbnew.FLIP_DIRECTION_LEFT_RIGHT)
    a, b = pads_of(old), pads_of(new)
    if set(a) != set(b) or any(abs(a[k][0] - b[k][0]) > TOL or abs(a[k][1] - b[k][1]) > TOL
                               for k in a):
        print("Pads stimmen nicht ueberein, Tausch waere nicht routing-neutral:")
        for k in sorted(a, key=lambda s: int(s) if s.isdigit() else 0):
            if k not in b or abs(a[k][0] - b[k][0]) > TOL or abs(a[k][1] - b[k][1]) > TOL:
                print(f"   Pad {k}: alt {a[k]}  neu {b.get(k)}")
        return 1
    print(f"{len(a)} Pads deckungsgleich, Tausch ist routing-neutral")

    keep = dict(pos=old.GetPosition(), rot=old.GetOrientationDegrees(),
                flip=old.IsFlipped(), val=old.GetValue(), dnp=old.IsDNP(),
                rtext=old.Reference().GetPosition() - old.GetPosition(),
                rangle=old.Reference().GetTextAngleDegrees(),
                rlayer=old.Reference().GetLayer(),
                rsize=old.Reference().GetTextSize(),
                rvis=old.Reference().IsVisible())
    nets = {p.GetNumber(): p.GetNet() for p in old.Pads()}
    oldfp = old.GetFPIDAsString().split(":")[-1]

    board.Remove(old)
    board.Add(new)
    new.SetReference(ref)
    new.SetValue(keep["val"])
    new.SetPosition(keep["pos"])          # rotation and side were already applied above
    new.SetDNP(keep["dnp"])
    for p in new.Pads():
        if p.GetNumber() in nets:
            p.SetNet(nets[p.GetNumber()])
    r = new.Reference()
    r.SetPosition(new.GetPosition() + keep["rtext"])
    r.SetTextAngleDegrees(keep["rangle"])
    r.SetLayer(keep["rlayer"])
    r.SetTextSize(keep["rsize"])
    r.SetVisible(keep["rvis"])

    pcbnew.SaveBoard(BOARD, board)
    print(f"{ref}: {oldfp} -> {name}, gespeichert")
    return 0


if __name__ == "__main__":
    sys.exit(main())
