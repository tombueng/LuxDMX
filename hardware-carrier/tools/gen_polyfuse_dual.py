#!/usr/bin/env python3
"""Build a polyfuse land that takes both Bourns radial lead pitches, and drop it on the board.

Series matters more than current here. The AEC-Q200 MF-RHT and the MF-RG are rated
**16 V** above 1 A, which is under a 24 V pixel supply, and Vmax on a PPTC is what it has to
hold off once it has tripped. Only the plain MF-R reaches 30 V:

    MF-R110 .. MF-R400    30 V   5.08 mm   up to Ihold 4.0 A / Itrip 8.0 A
    MF-R500 .. MF-R900    30 V   10.2 mm   up to Ihold 9.0 A / Itrip 18.0 A
    MF-R1100              16 V             falls back off 24 V, so 9 A is the ceiling

Bourns changes lead pitch in the middle of that range, so a two-hole land would force a
choice between 4 A and 9 A. Three holes take both: left hole shared, middle for the 5.08 mm
parts, right for the 10.2 mm parts. (At 12 V the MF-RHT and MF-RG parts fit the same holes
and go higher, up to 13 A. They are simply out of spec at 24 V.)

The solder bridge lives inside this footprint rather than beside it, so it cannot get
orphaned when the fuse is moved. Same pad numbers as the holes, so KiCad puts it on the
right nets by itself:

        A(1)          B(2)          C(2)
         O    [1|2]    O             O          front: through holes
              back            |<-- 10-13 A -->|
              bridge   |<-- <=9 A -->|

Every offset is read out of the real Bourns footprints, nothing is typed in from a drawing.
The script asserts that before it writes anything.

Run:  python hardware-carrier/gen_polyfuse_dual.py [--no-place]
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
LIB = os.path.join(HERE, "footprints", "LuxDMXCarrierCustom.pretty")
KIFUSE = "/usr/share/kicad/footprints/Fuse.pretty"
NAME = "polyfuse-dual-pitch"
REF = "Polyfuse MF-R 30V + Bruecke"

# Hole positions are derived from these two KiCad footprints, not typed in. KiCad ships no
# MF-R footprint, but MF-R uses the same two pitches, so the assert below ties the derived
# geometry back to the MF-R datasheet numbers rather than trusting the coincidence.
SMALL, BIG = "Fuse_Bourns_MF-RHT900", "Fuse_Bourns_MF-RHT1300"
MFR_PITCH = (5.08, 10.2)         # mfr.pdf, "Lead spacing" MF-R005~R400 / MF-R500~R1100
MFR_LEAD = 0.81                  # mfr.pdf, lead dia for MF-R500~R1100 (0.51 for the small)
DRILL, PAD = 1.20, 2.20          # 1.20 covers the MF-RHT1300 lead, the widest in the family
BR_H, BR_GAP = 4.00, 0.30        # bridge pad height and the seam you blob across
# The bridge pads used to be 0.90 mm wide and stopped 2 mm short of their own through-hole,
# so the only way onto the net was a track squeezed past the neighbouring pad: 0.35 mm, then
# 0.90 mm once measured properly, next to a rail doing 10 A. Now each pad runs from the seam
# all the way to its own hole and overlaps it, so there is no track at all and the narrowest
# cross-section is BR_H, the pad's own height. Widths are computed from the hole positions,
# not typed in, so they follow the lead pitch.
MIN_CLEAR = 0.25


def read(name):
    """pad1 offset, pad2 offset, and the F.Fab body extent, straight from the library."""
    fp = pcbnew.FootprintLoad(KIFUSE, name)
    if fp is None:
        raise SystemExit(f"{name} nicht in {KIFUSE}")
    ps = sorted(fp.Pads(), key=lambda p: pcbnew.ToMM(p.GetPosition().x))
    o = [(pcbnew.ToMM(p.GetPosition().x), pcbnew.ToMM(p.GetPosition().y)) for p in ps]
    drills = [pcbnew.ToMM(p.GetDrillSizeX()) for p in ps]
    xs, ys = [], []
    for g in fp.GraphicalItems():
        if g.GetLayer() != pcbnew.F_Fab:
            continue
        r = g.GetBoundingBox()
        xs += [pcbnew.ToMM(r.GetLeft()), pcbnew.ToMM(r.GetRight())]
        ys += [pcbnew.ToMM(r.GetTop()), pcbnew.ToMM(r.GetBottom())]
    # everything relative to pad 1
    body = (min(xs) - o[0][0], min(ys) - o[0][1], max(xs) - o[0][0], max(ys) - o[0][1])
    return (o[1][0] - o[0][0], o[1][1] - o[0][1]), body, max(drills)


def rect(layer, x0, y0, x1, y1, w=0.12):
    return (f'  (fp_rect (start {x0:.3f} {y0:.3f}) (end {x1:.3f} {y1:.3f}) '
            f'(stroke (width {w}) (type solid)) (fill none) (layer "{layer}"))')


def text(layer, s, x, y, size=0.8, mirror=False):
    j = " (justify mirror)" if mirror else ""
    return (f'  (fp_text user "{s}" (at {x:.3f} {y:.3f}) (layer "{layer}") '
            f'(effects (font (size {size} {size}) (thickness 0.15)){j}))')


def main():
    (bx, by), sbody, sdrill = read(SMALL)
    (cx, cy), bbody, bdrill = read(BIG)
    print(f"{SMALL[12:]:9s} Pad2 ({bx:5.2f},{by:5.2f})  Bohrung {sdrill:.2f}  "
          f"Koerper x {sbody[0]:6.2f}..{sbody[2]:5.2f}  y {sbody[1]:5.2f}..{sbody[3]:5.2f}")
    print(f"{BIG[12:]:9s} Pad2 ({cx:5.2f},{cy:5.2f})  Bohrung {bdrill:.2f}  "
          f"Koerper x {bbody[0]:6.2f}..{bbody[2]:5.2f}  y {bbody[1]:5.2f}..{bbody[3]:5.2f}")

    # The whole idea rests on the two families sharing pad 1 and the same y stagger. If
    # Bourns ever changes that, this must fail loudly rather than emit a wrong land.
    if abs(by - cy) > 0.01:
        raise SystemExit(f"y-Versatz unterschiedlich ({by} vs {cy}), gemeinsames Pad 1 geht nicht")
    if DRILL + 1e-6 < max(sdrill, bdrill, MFR_LEAD):
        raise SystemExit(f"Bohrung {DRILL} zu klein fuer {max(sdrill, bdrill, MFR_LEAD)}")
    for got, want in ((bx, MFR_PITCH[0]), (cx, MFR_PITCH[1])):
        if abs(got - want) > 0.1:
            raise SystemExit(f"Raster {got:.2f} passt nicht zum MF-R-Datenblatt ({want})")
    print(f"  gemeinsamer y-Versatz {by:.2f} mm, Bohrung {DRILL} deckt beide "
          f"(dickstes Bein {max(sdrill, bdrill, MFR_LEAD):.2f})")
    print(f"  Raster {bx:.2f} / {cx:.2f} deckt sich mit MF-R {MFR_PITCH[0]} / {MFR_PITCH[1]}")

    holes = [("1", 0.0, 0.0), ("2", bx, by), ("2", cx, cy)]
    # bridge between A and B, which is the only gap with two different nets across it
    mx, my = bx / 2, by / 2
    # each pad spans from its side of the seam to the centre of its own hole, so the two
    # merge into one piece of copper and the bypass carries what BR_H allows
    l0, l1 = 0.0, mx - BR_GAP / 2
    r0, r1 = mx + BR_GAP / 2, bx
    bridge = [("1", (l0 + l1) / 2, my, l1 - l0), ("2", (r0 + r1) / 2, my, r1 - r0)]

    # ---- clearance, computed not assumed ------------------------------------------
    def hole_box(h):
        return [h[1] - PAD / 2, h[2] - PAD / 2, h[1] + PAD / 2, h[2] + PAD / 2]

    def br_box(b):
        return [b[1] - b[3] / 2, b[2] - BR_H / 2, b[1] + b[3] / 2, b[2] + BR_H / 2]

    def gap(a, b):
        dx = max(a[0] - b[2], b[0] - a[2], 0.0)
        dy = max(a[1] - b[3], b[1] - a[3], 0.0)
        return (dx * dx + dy * dy) ** 0.5

    items = [(f"Loch {h[0]}@{h[1]:.2f}", hole_box(h), h[0]) for h in holes] + \
            [(f"Bruecke {b[0]}", br_box(b), b[0]) for b in bridge]
    worst = (99.0, "")
    for i in range(len(items)):
        for k in range(i + 1, len(items)):
            d = gap(items[i][1], items[k][1])
            tag = f"{items[i][0]} <-> {items[k][0]}"
            if items[i][2] != items[k][2]:
                if d < worst[0]:
                    worst = (d, tag)
                if d <= 0.0:
                    raise SystemExit(f"{tag} ueberlappen, verschiedene Netze")
            elif d <= 0.0 and "Bruecke" not in tag:
                raise SystemExit(f"{tag} ueberlappen")
    print(f"  engster Abstand zwischen verschiedenen Netzen: {worst[0]:.3f} mm ({worst[1]})")
    if worst[0] < MIN_CLEAR:
        raise SystemExit(f"zu eng, mindestens {MIN_CLEAR} noetig")

    # ---- emit ---------------------------------------------------------------------
    L = [
        f'(footprint "{NAME}"',
        '  (version 20240108)',
        '  (generator "luxdmx-carrier-gen_polyfuse_dual")',
        '  (layer "F.Cu")',
        f'  (descr "Bourns radial polyfuse land taking both lead pitches, plus solder-bridge '
        f'pads on the back. Use the MF-R series at 24 V: it is rated 30 V, while MF-RHT and '
        f'MF-RG are only 16 V above 1 A. Middle hole = 5.08 mm (MF-R110..R400, up to Ihold '
        f'4 A / Itrip 8 A), right hole = 10.2 mm (MF-R500..R900, up to Ihold 9 A / Itrip '
        f'18 A). MF-R1100 drops back to 16 V, so 9 A is the ceiling on a 24 V rail. At 12 V '
        f'the 16 V parts fit the same holes and reach 13 A. Holes {DRILL} mm clear the '
        f'0.81 mm MF-R lead. Bridge pads {BR_H} mm tall, {BR_GAP} mm apart on B.Cu, each '
        f'running into its own hole: leave '
        f'the fuse off and blob them for an unfused board. Hole offsets generated from the '
        f'KiCad Bourns footprints and checked against the MF-R datasheet pitches.")',
        '  (tags "polyfuse pptc fuse dual-pitch solder-bridge hand-solder")',
        '  (attr through_hole)',
        f'  (fp_text reference "REF**" (at {bbody[0]:.2f} {bbody[1] - 1.4:.2f}) '
        f'(layer "F.SilkS") (effects (font (size 0.9 0.9) (thickness 0.15)) (justify left)))',
        f'  (fp_text value "{NAME}" (at {bbody[0]:.2f} {bbody[3] + 1.4:.2f}) '
        f'(layer "F.Fab") (effects (font (size 0.9 0.9) (thickness 0.15)) (justify left)))',
        # 0.5 mm outside the body: drawn on the nominal outline the silk sits on the
        # through-holes and KiCad reports silk_over_copper
        rect("F.SilkS", sbody[0] - 0.5, sbody[1] - 0.5, sbody[2] + 0.5, sbody[3] + 0.5),
        rect("F.SilkS", bbody[0] - 0.5, bbody[1] - 0.5, bbody[2] + 0.5, bbody[3] + 0.5),
        rect("F.Fab", *bbody, w=0.10),
        rect("F.CrtYd", bbody[0] - 0.25, bbody[1] - 0.25, bbody[2] + 0.25, bbody[3] + 0.25,
             w=0.05),
        text("F.SilkS", "4A/30V", bx, bbody[3] + 1.4, 0.7),
        text("F.SilkS", "9A/30V", cx, bbody[3] + 1.4, 0.7),
        text("B.SilkS", "BRIDGE", mx, my - BR_H / 2 - 1.0, 0.7, mirror=True),
    ]
    for num, x, y in holes:
        L.append(f'  (pad "{num}" thru_hole circle (at {x:.3f} {y:.3f}) '
                 f'(size {PAD} {PAD}) (drill {DRILL}) (layers "*.Cu" "*.Mask"))')
    for num, x, y, w in bridge:
        L.append(f'  (pad "{num}" smd rect (at {x:.3f} {y:.3f}) '
                 f'(size {w:.3f} {BR_H}) (layers "B.Cu" "B.Mask"))')
    L.append(")")

    os.makedirs(LIB, exist_ok=True)
    out = os.path.join(LIB, NAME + ".kicad_mod")
    with open(out, "w", encoding="utf-8") as fh:
        fh.write("\n".join(L) + "\n")
    print(f"\ngeschrieben: {os.path.relpath(out, HERE)}")

    # re-read what was written and check it against the libraries again
    chk = pcbnew.FootprintLoad(LIB, NAME)
    if chk is None:
        raise SystemExit("erzeugtes Footprint laesst sich nicht laden")
    got = sorted(((p.GetNumber(), round(pcbnew.ToMM(p.GetPosition().x), 3),
                   round(pcbnew.ToMM(p.GetPosition().y), 3)) for p in chk.Pads()),
                 key=lambda t: (t[1], t[2]))
    print("  Pads zurueckgelesen: " + ", ".join(f"{n}@({x},{y})" for n, x, y in got))
    want = {(round(0.0, 3), round(0.0, 3)), (round(bx, 3), round(by, 3)),
            (round(cx, 3), round(cy, 3))}
    have = {(x, y) for n, x, y in got if any(abs(x - h[1]) < 1e-6 and abs(y - h[2]) < 1e-6
                                            for h in holes)}
    if not want <= have:
        raise SystemExit(f"Lochlagen weichen ab: erwartet {want}, gelesen {have}")
    print("  Lochlagen decken sich mit beiden Bourns-Footprints")

    if "--no-place" in sys.argv:
        return 0

    # ---- put it on the board, outside the outline ---------------------------------
    board = pcbnew.LoadBoard(BOARD)
    for f in list(board.GetFootprints()):
        if f.GetReference() == REF:
            board.Remove(f)
            print("\nalte Version entfernt")
    e = [s for s in board.GetDrawings() if s.GetLayer() == pcbnew.Edge_Cuts]
    ys = [pcbnew.ToMM(v) for s in e for v in (s.GetStart().y, s.GetEnd().y)]
    old = next((f for f in board.GetFootprints() if "olyfuse" in f.GetReference()), None)
    px = pcbnew.ToMM(sorted(old.Pads(), key=lambda p: pcbnew.ToMM(p.GetPosition().x))[0]
                     .GetPosition().x) if old else 130.0

    fp = pcbnew.FootprintLoad(LIB, NAME)
    board.Add(fp)
    fp.SetReference(REF)
    fp.SetValue("MF-R 30V: links+mitte bis 4A, links+rechts bis 9A")
    fp.SetPosition(pcbnew.VECTOR2I(pcbnew.FromMM(px), pcbnew.FromMM(max(ys) + 12.0)))
    nets = {n.GetNetname(): n for n in board.GetNetInfo().NetsByName().values()}
    for p in fp.Pads():
        p.SetNet(nets["V_PIX_IN" if p.GetNumber() == "1" else "V_PIX"])
    print(f"\nplatziert bei ({px:.2f},{max(ys) + 12.0:.2f}), unterhalb der Outline")
    print(f"  Pad 1 -> V_PIX_IN, Pad 2 -> V_PIX")
    pcbnew.SaveBoard(BOARD, board)
    print("gespeichert")
    return 0


if __name__ == "__main__":
    sys.exit(main())
