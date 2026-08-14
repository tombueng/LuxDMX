#!/usr/bin/env python3
"""Put the rotary encoder on the carrier itself, instead of a header at the edge.

The KY-040 module that the 5-pin header was for is an EC11 encoder, three 10k pullups and a
header. The pullups are not needed: ENC_A is GPIO42, ENC_B GPIO41 and ENC_SW GPIO21, all
ordinary S3 pins with internal pullups, none of them strapping pins. So the module buys
nothing that the bare encoder does not, and it costs a 5-pin header at the board edge plus
three signals that have to cross the whole board to get there. ENC_SW was the connection that
would not route, run after run.

Pad names are the encoder's own, not numbers:

    A, B      the quadrature contacts        ENC_A, ENC_B
    C         their common                   GND
    S1, S2    the push switch                ENC_SW, GND
    MP        two plated mounting posts      GND, so the can is grounded and it sits still

The footprint is KiCad's own RotaryEncoder_Alps_EC11E-Switch_Vertical_H20mm, copied into the
project library so the board does not depend on a system path. Its 3D model is NOT part of
this KiCad installation - there is no Rotary_Encoder.3dshapes at all - so the model comes from
tools/gen_3d_parts.py like the polyfuse's does.

Placement is a starting point, not a decision: it goes in the largest clear rectangle that
fits, and it is meant to be dragged where the knob should actually be.

Removing the header and adding the encoder run in separate processes. Doing both to one board
in one pcbnew takes it down with SIGSEGV, the same trap as everywhere else here.

Run:  python tools/add_encoder.py [--at X,Y] [--rot DEG] [--keep-header]
"""
import os
import re
import subprocess
import sys

LIB = "footprints/LuxDMXCarrier.pretty"
FP = "encoder-ec11-switch"
REF = "Encoder A/B/SW"
MODEL = "${KIPRJMOD}/3dmodels/encoder-ec11-switch.wrl"
HEADER = "ENC"                      # reference prefix of the header it replaces
NETS = {"A": "ENC_A", "B": "ENC_B", "C": "GND",
        "S1": "ENC_SW", "S2": "GND", "MP": "GND"}
SIZE = (17.5, 14.2)                 # what the footprint needs, pads included
KEEP = 1.0                          # clear space wanted round it


def _project_dir():
    d = os.path.dirname(os.path.abspath(__file__))
    for _ in range(3):
        if os.path.exists(os.path.join(d, "luxdmx-carrier.kicad_pcb")):
            return d
        d = os.path.dirname(d)
    return os.path.dirname(os.path.abspath(__file__))


HERE = _project_dir()
BOARD = os.path.join(HERE, "luxdmx-carrier.kicad_pcb")


def stage_drop():
    """Take the old header off the board."""
    import pcbnew
    b = pcbnew.LoadBoard(BOARD)
    gone = []
    for f in list(b.GetFootprints()):
        if f.GetReference().upper().startswith(HEADER):
            gone.append(f"{f.GetReference()} bei "
                        f"({pcbnew.ToMM(f.GetPosition().x):.1f}, "
                        f"{pcbnew.ToMM(f.GetPosition().y):.1f})")
            b.Remove(f)
    pcbnew.SaveBoard(BOARD, b)
    for g in gone:
        print(f"  Header entfernt: {g}")
    print(f"\n@@RESULT {len(gone)}", flush=True)


def stage_drop_tracks():
    """And its stubs, which now hang off nothing."""
    import pcbnew
    b = pcbnew.LoadBoard(BOARD)
    n = 0
    for t in list(b.GetTracks()):
        if t.GetNetname() in ("ENC_A", "ENC_B", "ENC_SW"):
            b.Remove(t)
            n += 1
    pcbnew.SaveBoard(BOARD, b)
    print(f"\n@@RESULT {n}", flush=True)


def free_spot(b):
    """Where to drop it: clear space if there is any, otherwise the least bad overlap.

    There is no clear space. The largest free rectangle on this board is 8 x 8 mm and the
    encoder needs 17.5 x 14.2, so a placement that collides with nothing does not exist and
    saying "no room" and stopping would just leave the part unwired. It goes down where it
    overlaps least, and what it lands on is printed, because a human has to move something
    either way and wants to know what.
    """
    import pcbnew
    e = [s for s in b.GetDrawings() if s.GetLayer() == pcbnew.Edge_Cuts]
    xs = [pcbnew.ToMM(v) for s in e for v in (s.GetStart().x, s.GetEnd().x)]
    ys = [pcbnew.ToMM(v) for s in e for v in (s.GetStart().y, s.GetEnd().y)]
    taken = []
    for f in b.GetFootprints():
        bb = f.GetBoundingBox()
        taken.append((f.GetReference(),
                      pcbnew.ToMM(bb.GetLeft()), pcbnew.ToMM(bb.GetRight()),
                      pcbnew.ToMM(bb.GetTop()), pcbnew.ToMM(bb.GetBottom())))
    w, h = SIZE[0] + 2 * KEEP, SIZE[1] + 2 * KEEP
    best = None
    y = min(ys) + 1.0
    while y + h <= max(ys) - 1.0:
        x = min(xs) + 1.0
        while x + w <= max(xs) - 1.0:
            over = 0.0
            for _r, x0, x1, y0, y1 in taken:
                ox = min(x + w, x1) - max(x, x0)
                oy = min(y + h, y1) - max(y, y0)
                if ox > 0 and oy > 0:
                    over += ox * oy
            edge = -min(x - min(xs), max(xs) - (x + w),
                        y - min(ys), max(ys) - (y + h))
            if best is None or (over, edge) < (best[0], best[1]):
                best = (over, edge, x + KEEP, y + KEEP, taken)
            x += 0.5
        y += 0.5
    if best is None:
        return None
    over, _edge, bx, by, taken = best
    if over > 0:
        print(f"  kein freier Platz, {over:.0f} mm2 Ueberlappung ist das Wenigste, was geht")
        for r, x0, x1, y0, y1 in taken:
            ox = min(bx - KEEP + w, x1) - max(bx - KEEP, x0)
            oy = min(by - KEEP + h, y1) - max(by - KEEP, y0)
            if ox > 0 and oy > 0:
                print(f"     liegt auf {r[:34]:34s} {ox * oy:5.0f} mm2")
    return (over, bx, by)


def stage_add(at, rot):
    import pcbnew
    b = pcbnew.LoadBoard(BOARD)
    fp = pcbnew.FootprintLoad(os.path.join(HERE, LIB), FP)
    if fp is None:
        sys.exit(f"{FP} nicht in {LIB}")
    if at:
        x, y = [float(v) for v in at.split(",")]
    else:
        spot = free_spot(b)
        if spot is None:
            sys.exit("kein freier Platz von "
                     f"{SIZE[0]:.1f} x {SIZE[1]:.1f} mm auf der Platine")
        _room, x, y = spot
        print(f"  freier Platz gefunden bei ({x:.2f}, {y:.2f})")
    b.Add(fp)
    fp.SetReference(REF)
    fp.SetValue("EC11")
    fp.SetPosition(pcbnew.VECTOR2I(pcbnew.FromMM(x), pcbnew.FromMM(y)))
    fp.SetOrientationDegrees(rot)
    missing = []
    for p in fp.Pads():
        want = NETS.get(p.GetNumber())
        n = b.FindNet(want) if want else None
        if n is None:
            missing.append(f"{p.GetNumber()} -> {want}")
            continue
        p.SetNet(n)
        print(f"  Pad {p.GetNumber():3s} an {want}")
    for m3 in list(fp.Models()):
        fp.Models().pop()
    m = pcbnew.FP_3DMODEL()
    m.m_Filename = MODEL
    fp.Models().push_back(m)
    pcbnew.SaveBoard(BOARD, b)
    if missing:
        print("  Netz nicht gefunden: " + ", ".join(missing))
    print(f"\n@@RESULT {len(list(fp.Pads())) - len(missing)}", flush=True)


def sub(*a):
    r = subprocess.run([sys.executable, os.path.abspath(__file__), "--stage", *a],
                       capture_output=True, text=True)
    m = re.search(r"@@RESULT ([^\n]*)", r.stdout)
    if not m:
        raise RuntimeError(f"Stage {a[0]}:\n{r.stdout[-900:]}\n{r.stderr[-600:]}")
    print("\n".join(l for l in r.stdout.splitlines() if l.startswith("  ")))
    return m.group(1)


def main():
    if "--stage" in sys.argv:
        i = sys.argv.index("--stage")
        name = sys.argv[i + 1]
        if name == "drop":
            return stage_drop()
        if name == "droptracks":
            return stage_drop_tracks()
        return stage_add(None if sys.argv[i + 2] == "-" else sys.argv[i + 2],
                         float(sys.argv[i + 3]))

    at = sys.argv[sys.argv.index("--at") + 1] if "--at" in sys.argv else "-"
    rot = float(sys.argv[sys.argv.index("--rot") + 1]) if "--rot" in sys.argv else 0.0
    if "--keep-header" not in sys.argv:
        print(f"{sub('drop')} Header entfernt, "
              f"{sub('droptracks')} zugehoerige Bahnen aufgeraeumt")
    print(f"{sub('add', at, str(rot))} Pads verdrahtet")
    return 0


if __name__ == "__main__":
    sys.exit(main())
