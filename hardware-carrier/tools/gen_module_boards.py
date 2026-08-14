#!/usr/bin/env python3
"""Build the two plug-in modules as real KiCad boards, then export them as 3D models.

Hand-written VRML boxes look like hand-written VRML boxes. These two are small enough to
draw properly: place library footprints, which brings their own STEP models along, route a
few tracks, and let `kicad-cli pcb export step --include-tracks` turn the whole thing into
one model with copper, silkscreen and soldermask.

  MAX3485   19.30 x 13.37 mm. Component positions from img/max3485-module-photo.jpg, scaled
            against the two pad columns (15.24 mm apart, 56.4 px/mm). Real SOIC-8, real
            0805s, real headers.

  W5500     23.0 x 25.0 mm from the USR-ES1 datasheet drawing, pin field matching the carrier
            footprint (2 x 6, rows 20.32 mm, 2.54 pitch), pin 1 6.40 mm in from the jack end.
            The RJ45 is the Molex 9346520x, which is the horizontal jack whose model KiCad
            actually ships; the Hanrun footprint points at a STEP file that is not in the
            package. It overhangs the jack end by 2.50 mm, which is what puts it past the
            carrier edge. The W5500 chip itself sits on the underside of the real module and
            is never visible, so it is left out. The tracks from the jack to the headers are
            decoration, not the real netlist.

The headers go on the BACK of both boards. That is not cosmetic: it puts the plastic spacer
between the module and the carrier, the short pin ends up through the module where they get
soldered, and the long ends down into the carrier. On the front the model comes out inverted,
module hovering on its pin tips with the spacer sitting on top of it.

Neither board is meant to be manufactured. They exist to be looked at.

Run:  python tools/gen_module_boards.py
"""
import os
import re
import subprocess
import sys

FP = "/usr/share/kicad/footprints"


def _project_dir():
    d = os.path.dirname(os.path.abspath(__file__))
    for _ in range(3):
        if os.path.exists(os.path.join(d, "luxdmx-carrier.kicad_pcb")):
            return d
        d = os.path.dirname(d)
    return os.path.dirname(os.path.abspath(__file__))


HERE = _project_dir()
WORK = os.path.join(HERE, "modules")
OUT = os.path.join(HERE, "3dmodels")
CX, CY = 100.0, 100.0          # both boards are centred here, and that becomes the origin


def build(kind, path):
    import pcbnew
    b = pcbnew.CreateEmptyBoard()
    nets = {}

    def net(name):
        if name not in nets:
            n = pcbnew.NETINFO_ITEM(b, name)
            b.Add(n)
            nets[name] = n
        return nets[name]

    def place(lib, name, ref, x, y, rot=0, val=""):
        fp = pcbnew.FootprintLoad(os.path.join(FP, lib), name)
        if fp is None:
            raise SystemExit(f"{lib}/{name} nicht gefunden")
        b.Add(fp)
        fp.SetReference(ref)
        fp.SetValue(val or ref)
        fp.SetOrientationDegrees(rot)
        fp.SetPosition(pcbnew.VECTOR2I(pcbnew.FromMM(CX + x), pcbnew.FromMM(CY + y)))
        fp.Reference().SetVisible(False)
        fp.Value().SetVisible(False)
        return fp

    def to_back(fp):
        """Move a header to the back of the module board.

        Mirrored left to right, not top to bottom: the pins of a 1xN vertical header all sit
        at footprint x = 0, so this leaves every pad exactly where it was and keeps the pin
        order. The other direction would renumber the row back to front."""
        fp.Flip(fp.GetPosition(), pcbnew.FLIP_DIRECTION_LEFT_RIGHT)
        return fp

    def wire(fp, mapping):
        for num, nn in mapping.items():
            for p in fp.Pads():
                if p.GetNumber() == str(num):
                    p.SetNet(net(nn))

    def outline(w, h, ox=0.0, oy=0.0):
        c = [(-w / 2 + ox, -h / 2 + oy), (w / 2 + ox, -h / 2 + oy),
             (w / 2 + ox, h / 2 + oy), (-w / 2 + ox, h / 2 + oy)]
        for i in range(4):
            s = pcbnew.PCB_SHAPE(b)
            s.SetShape(pcbnew.SHAPE_T_SEGMENT)
            s.SetLayer(pcbnew.Edge_Cuts)
            s.SetWidth(pcbnew.FromMM(0.1))
            s.SetStart(pcbnew.VECTOR2I(pcbnew.FromMM(CX + c[i][0]), pcbnew.FromMM(CY + c[i][1])))
            j = (i + 1) % 4
            s.SetEnd(pcbnew.VECTOR2I(pcbnew.FromMM(CX + c[j][0]), pcbnew.FromMM(CY + c[j][1])))
            b.Add(s)

    def pad_at(fp, num):
        for p in fp.Pads():
            if p.GetNumber() == str(num):
                q = p.GetPosition()
                return pcbnew.ToMM(q.x) - CX, pcbnew.ToMM(q.y) - CY
        raise KeyError(num)

    def track(a, bb, nn, w=0.35, layer=None):
        t = pcbnew.PCB_TRACK(b)
        t.SetStart(pcbnew.VECTOR2I(pcbnew.FromMM(CX + a[0]), pcbnew.FromMM(CY + a[1])))
        t.SetEnd(pcbnew.VECTOR2I(pcbnew.FromMM(CX + bb[0]), pcbnew.FromMM(CY + bb[1])))
        t.SetWidth(pcbnew.FromMM(w))
        t.SetLayer(layer if layer is not None else pcbnew.F_Cu)
        t.SetNet(net(nn))
        b.Add(t)

    def route(p, q, nn, w=0.35, bend="h", layer=None):
        """Two segments with one right-angle bend, so it reads as routed copper."""
        mid = (q[0], p[1]) if bend == "h" else (p[0], q[1])
        track(p, mid, nn, w, layer)
        track(mid, q, nn, w, layer)

    if kind == "max3485":
        outline(19.30, 13.37)
        h3 = to_back(place("Connector_PinHeader_2.54mm.pretty",
                           "PinHeader_1x03_P2.54mm_Vertical", "J1", -7.62, -2.54, 0))
        h5 = to_back(place("Connector_PinHeader_2.54mm.pretty",
                           "PinHeader_1x05_P2.54mm_Vertical", "J2", 7.62, -5.08, 0))
        u1 = place("Package_SO.pretty", "SOIC-8_3.9x4.9mm_P1.27mm", "U1", 1.15, 1.24, 0)
        r_term = place("Resistor_SMD.pretty", "R_0805_2012Metric", "R2", -4.90, 0.30, 90)
        r_bias1 = place("Resistor_SMD.pretty", "R_0805_2012Metric", "R1", -4.90, -3.60, 90)
        r_bias2 = place("Resistor_SMD.pretty", "R_0805_2012Metric", "R3", -4.90, 4.10, 90)
        r_led = place("Resistor_SMD.pretty", "R_0805_2012Metric", "R4", 0.60, -3.30, 90)
        c1 = place("Capacitor_SMD.pretty", "C_0805_2012Metric", "C1", 3.30, -3.30, 90)
        r_dir = place("Resistor_SMD.pretty", "R_0805_2012Metric", "R5", 3.60, 5.40, 90)
        d1 = place("LED_SMD.pretty", "LED_0805_2012Metric", "D1", -2.10, -4.10, 90)

        wire(h3, {1: "GND", 2: "A", 3: "B"})
        wire(h5, {1: "EN", 2: "VCC", 3: "DI", 4: "RO", 5: "GND"})
        wire(u1, {1: "RO", 2: "EN", 3: "EN", 4: "DI", 5: "GND", 6: "A", 7: "B", 8: "VCC"})
        wire(r_term, {1: "A", 2: "B"})
        wire(r_bias1, {1: "VCC", 2: "A"})
        wire(r_bias2, {1: "B", 2: "GND"})
        wire(r_led, {1: "VCC", 2: "LEDA"})
        wire(d1, {1: "LEDA", 2: "GND"})
        wire(c1, {1: "VCC", 2: "GND"})
        wire(r_dir, {1: "EN", 2: "GND"})

        route(pad_at(u1, 6), pad_at(r_term, 1), "A", bend="v")
        route(pad_at(r_term, 1), pad_at(h3, 2), "A", bend="v")
        route(pad_at(u1, 7), pad_at(r_term, 2), "B", bend="v")
        route(pad_at(r_term, 2), pad_at(h3, 3), "B", bend="v")
        route(pad_at(r_bias1, 2), pad_at(r_term, 1), "A", bend="v")
        route(pad_at(r_bias2, 1), pad_at(r_term, 2), "B", bend="v")
        route(pad_at(u1, 1), pad_at(h5, 4), "RO")
        route(pad_at(u1, 4), pad_at(h5, 3), "DI")
        route(pad_at(u1, 2), pad_at(u1, 3), "EN", bend="v")
        route(pad_at(u1, 3), pad_at(h5, 1), "EN")
        route(pad_at(r_dir, 1), pad_at(h5, 1), "EN", bend="v")
        route(pad_at(u1, 8), pad_at(c1, 1), "VCC")
        route(pad_at(c1, 1), pad_at(h5, 2), "VCC", bend="v")
        route(pad_at(r_led, 1), pad_at(c1, 1), "VCC")
        route(pad_at(r_led, 2), pad_at(d1, 1), "LEDA")
        route(pad_at(u1, 5), pad_at(h3, 1), "GND", bend="v")
        route(pad_at(c1, 2), pad_at(h5, 5), "GND", bend="v")
        route(pad_at(d1, 2), pad_at(h3, 1), "GND", bend="v")
        route(pad_at(r_dir, 2), pad_at(h5, 5), "GND", bend="v")

    else:
        # Pin field matches the carrier footprint: x +-10.16, y -6.10 .. +6.60. Pin 1 sits
        # 6.40 mm in from the jack end, so that edge is at y -12.50 and the board runs to
        # +12.50.
        outline(23.0, 25.0)
        j1 = to_back(place("Connector_PinHeader_2.54mm.pretty",
                           "PinHeader_1x06_P2.54mm_Vertical", "J1", -10.16, -6.10, 0))
        j2 = to_back(place("Connector_PinHeader_2.54mm.pretty",
                           "PinHeader_1x06_P2.54mm_Vertical", "J2", 10.16, -6.10, 0))
        # The jack faces the pin-1 end, so 180 degrees. Around its own origin the body sits
        # at x -3.71..12.60, y -8.20..17.30, which the rotation negates: the opening lands
        # at -17.30 and the body centre at x -4.45. Placing the origin at (4.45, 2.30) puts
        # the opening 2.50 mm past the board edge, the overhang the datasheet gives, and
        # centres the body across the width.
        rj = place("Connector_RJ.pretty", "RJ45_Molex_9346520x_Horizontal", "J3",
                   4.45, 2.30, 180)
        names = [f"TD{i}" for i in range(1, 9)]
        wire(j1, {i + 1: names[i] for i in range(6)})
        wire(j2, {i + 1: names[i] for i in range(6)})
        for i in range(1, 9):
            wire(rj, {i: names[i - 1]})
        for i in range(6):
            try:
                route(pad_at(rj, i + 1), pad_at(j1 if i % 2 == 0 else j2, i + 1),
                      names[i], w=0.3, bend="v")
            except KeyError:
                pass

    pcbnew.SaveBoard(path, b)
    # Stackup mit blauem Loetstopplack nachtragen: pcbnew gibt die Farbe ueber Python nicht
    # her, der STEP-Export liest sie aber aus der Datei.
    txt = open(path, encoding="utf-8").read()
    if "(stackup" not in txt:
        stack = (
            '\n\t\t(stackup\n'
            '\t\t\t(layer "F.SilkS" (type "Top Silk Screen"))\n'
            '\t\t\t(layer "F.Paste" (type "Top Solder Paste"))\n'
            '\t\t\t(layer "F.Mask" (type "Top Solder Mask") (color "Blue") (thickness 0.01))\n'
            '\t\t\t(layer "F.Cu" (type "copper") (thickness 0.035))\n'
            '\t\t\t(layer "dielectric 1" (type "core") (thickness 1.51) (material "FR4")'
            ' (epsilon_r 4.5) (loss_tangent 0.02))\n'
            '\t\t\t(layer "B.Cu" (type "copper") (thickness 0.035))\n'
            '\t\t\t(layer "B.Mask" (type "Bottom Solder Mask") (color "Blue")'
            ' (thickness 0.01))\n'
            '\t\t\t(layer "B.Paste" (type "Bottom Solder Paste"))\n'
            '\t\t\t(layer "B.SilkS" (type "Bottom Silk Screen"))\n'
            '\t\t\t(copper_finish "ENIG")\n'
            '\t\t\t(dielectric_constraints no)\n'
            '\t\t)')
        i = txt.index("(setup") + len("(setup")
        open(path, "w", encoding="utf-8").write(txt[:i] + stack + txt[i:])
    n = len(list(b.GetFootprints()))
    t = len(list(b.GetTracks()))
    print(f"\n@@RESULT {n} {t}", flush=True)


def sub(*a):
    r = subprocess.run([sys.executable, os.path.abspath(__file__), "--stage", *a],
                       capture_output=True, text=True)
    m = re.search(r"@@RESULT ([^\n]*)", r.stdout)
    if not m:
        raise RuntimeError(f"{a}:\n{r.stdout[-700:]}\n{r.stderr[-500:]}")
    return m.group(1).split()


def main():
    if "--stage" in sys.argv:
        i = sys.argv.index("--stage")
        return build(sys.argv[i + 1], sys.argv[i + 2])

    os.makedirs(WORK, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    for kind, out in (("max3485", "desk_rakstore-max3485.step"),
                      ("w5500", "usr-es1-w5500-own.step")):
        pcb = os.path.join(WORK, f"{kind}-module.kicad_pcb")
        fps, trk = sub(kind, pcb)
        print(f"{kind:9s} {fps} Footprints, {trk} Leiterbahnen -> {os.path.basename(pcb)}")
        r = subprocess.run(["kicad-cli", "pcb", "export", "step", pcb,
                            "-o", os.path.join(OUT, out), "--force", "--subst-models",
                            "--include-tracks", "--include-pads", "--include-silkscreen",
                            "--include-soldermask", "--no-optimize-step",
                            "--user-origin", f"{CX}x{CY}mm"],
                           capture_output=True, text=True)
        p = os.path.join(OUT, out)
        if os.path.exists(p):
            print(f"          -> 3dmodels/{out}  {os.path.getsize(p)//1024} kB")
        else:
            print(f"          STEP-Export fehlgeschlagen: {r.stdout[-300:]} {r.stderr[-300:]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
