#!/usr/bin/env python3
"""3D models of the Pololu regulators that fit the 5 V regulator spot, built from real parts.

Same approach as gen_module_boards.py (and Feuerwerk's build_modules.py): a dummy KiCad board
the size of the module, stock footprints placed where the product has its parts, so their
bundled STEP models come along, then `kicad-cli pcb export step` turns it into one model.
No nets, nothing here is meant to be manufactured.

Layouts are read off Pololu's own dimension drawings (top views at 3:1, parts drawn in) and
the isometric views on the same sheets:

  D24V10F5   12.70 x 17.78 mm, 1.0 mm board (d24v10fx-step-down-voltage-regulator-dimensions.pdf).
             DFN-12 3 x 4 mm regulator left of centre, 6 x 6 x 2.8 mm shielded inductor
             bottom right (the drawing's tallest part, 2.8 mm), a block of 0805 ceramics
             between them, 0603s round the edge, one 1206 bottom left. Pins along the short
             edge, 1.27 mm in: PG, SHDN, VIN, GND, VOUT, left to right seen from the parts side.
  D36V28F5   17.8 x 20.3 mm, 1.57 mm board (d36v28fx-step-down-voltage-regulators-dimensions.pdf).
             7 x 7 mm inductor top left, two 6.3 mm SMD electrolytics (5.8 mm, the drawing's
             profile height), 1206/0805 ceramics bottom right. The regulator IC is on the label
             side, which faces the carrier and is never seen. Edge row EN, VIN, GND, GND, VOUT
             from the left, PG 2.54 mm above EN, M2 holes in two opposite corners.

The header goes on the label (back) side, like on the plug-in modules: that is how a Pololu
regulator sits on the carrier, parts facing out. Origin of each STEP is the module centre, its
z = 0 the underside of the module board; the carrier footprint lifts it by the 2.54 mm header
spacer.

Run:  python tools/gen_regulator_modules.py   (builds, exports, and hangs them on the carrier footprint)
"""
import os
import re
import subprocess
import sys


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
FP = "/usr/share/kicad/footprints"
CX, CY = 100.0, 100.0           # module centre on its dummy board, becomes the STEP origin

C06, C08, C12 = "Capacitor_SMD:C_0603_1608Metric", "Capacitor_SMD:C_0805_2012Metric", \
    "Capacitor_SMD:C_1206_3216Metric"
R06 = "Resistor_SMD:R_0603_1608Metric"
HDR5 = "Connector_PinHeader_2.54mm:PinHeader_1x05_P2.54mm_Vertical"

# name -> board, parts (footprint, x, y, rot), header (x of pin 1, y, pins), holes, silk
MODULES = {
    "pololu-d24v10f5": dict(
        w=12.70, h=17.78, th=1.0,
        parts=[
            ("Package_DFN_QFN:DFN-12-1EP_3x4mm_P0.5mm_EP1.7x3.3mm", -3.02, -2.45, 90),
            ("Inductor_SMD:L_Changjiang_FNR6028S", 2.51, 3.04, 0),
            (R06, -5.28, -6.30, 90), (R06, -2.72, -6.90, 0), (C06, 0.79, -6.90, 0),
            (C06, 0.79, -5.57, 0), (C06, -1.47, 0.88, 90), (R06, -5.21, 1.26, 90),
            (C06, -3.10, 3.15, 0),
            (C08, 3.78, -5.71, 0), (C08, 3.78, -4.17, 0), (C08, 3.78, -2.63, 0),
            (C08, 0.80, -4.06, 0), (C08, 0.80, -2.52, 0), (C08, 1.15, -0.90, 0),
            (C08, 4.25, -1.02, 0),
            (C12, -3.45, 5.02, 0),
        ],
        header=(-5.08, 7.62, 5),
        holes=[],
        labels=["PG", "SHDN", "VIN", "GND", "VOUT"],
        title="D24V10F5"),
    "pololu-d36v28f5": dict(
        w=17.8, h=20.3, th=1.57,
        parts=[
            ("Inductor_SMD:L_Wuerth_HCI-7050", -2.93, -5.83, 0),
            ("Capacitor_SMD:CP_Elec_6.3x5.8", -2.82, 1.42, 0),
            ("Capacitor_SMD:CP_Elec_6.3x5.8", 4.84, -1.00, 90),
            (C12, 3.60, -7.60, 90), (C12, 0.77, 5.33, 90), (C12, 2.96, 5.33, 90),
            (C08, 6.93, 4.28, 0), (C12, 6.23, 6.26, 0),
        ],
        header=(-2.55, 8.88, 5),
        holes=[(-6.70, 7.95), (6.70, -7.95)],
        labels=["EN", "VIN", "GND", "GND", "OUT"],
        title="D36V28F5"),
}


def build(name, path):
    import pcbnew
    spec = MODULES[name]
    b = pcbnew.CreateEmptyBoard()
    b.GetDesignSettings().SetBoardThickness(pcbnew.FromMM(spec["th"]))

    def at(x, y):
        return pcbnew.VECTOR2I(pcbnew.FromMM(CX + x), pcbnew.FromMM(CY + y))

    def place(fpid, ref, x, y, rot=0):
        lib, fname = fpid.split(":")
        fp = pcbnew.FootprintLoad(os.path.join(FP, lib + ".pretty"), fname)
        if fp is None:
            raise SystemExit(f"{fpid} not found")
        b.Add(fp)
        fp.SetReference(ref)
        fp.SetOrientationDegrees(rot)
        fp.SetPosition(at(x, y))
        fp.Reference().SetVisible(False)
        fp.Value().SetVisible(False)
        return fp

    w, h = spec["w"] / 2, spec["h"] / 2
    c = [(-w, -h), (w, -h), (w, h), (-w, h)]
    for i in range(4):
        s = pcbnew.PCB_SHAPE(b)
        s.SetShape(pcbnew.SHAPE_T_SEGMENT)
        s.SetLayer(pcbnew.Edge_Cuts)
        s.SetStart(at(*c[i]))
        s.SetEnd(at(*c[(i + 1) % 4]))
        s.SetWidth(pcbnew.FromMM(0.1))
        b.Add(s)

    for k, (fpid, x, y, rot) in enumerate(spec["parts"]):
        place(fpid, f"P{k + 1}", x, y, rot)

    # header along x, on the label side. Rotating the 1xN footprint by 90 lays its pins out
    # towards +x from pin 1; the top/bottom flip then moves it to the back without moving a pad.
    hx, hy, n = spec["header"]
    hd = place(HDR5, "J1", hx, hy, 90)
    hd.Flip(hd.GetPosition(), pcbnew.FLIP_DIRECTION_TOP_BOTTOM)
    xs = sorted(round(pcbnew.ToMM(p.GetPosition().x) - CX, 2) for p in hd.Pads())
    want = [round(hx + 2.54 * i, 2) for i in range(n)]
    if xs != want or not hd.IsFlipped():
        raise SystemExit(f"{name}: header pads at {xs}, wanted {want}")

    if spec["holes"]:
        holder = pcbnew.FOOTPRINT(b)
        holder.SetReference("H")
        holder.Reference().SetVisible(False)
        holder.Value().SetVisible(False)
        b.Add(holder)
        for i, (x, y) in enumerate(spec["holes"]):
            p = pcbnew.PAD(holder)
            p.SetNumber(str(i + 1))
            p.SetAttribute(pcbnew.PAD_ATTRIB_PTH)
            p.SetShape(pcbnew.PAD_SHAPE_CIRCLE)
            p.SetSize(pcbnew.VECTOR2I(pcbnew.FromMM(3.0), pcbnew.FromMM(3.0)))
            p.SetDrillSize(pcbnew.VECTOR2I(pcbnew.FromMM(2.18), pcbnew.FromMM(2.18)))
            p.SetLayerSet(p.PTHMask())
            p.SetPosition(at(x, y))
            holder.Add(p)

    def text(s, x, y, size, layer, rot=0):
        t = pcbnew.PCB_TEXT(b)
        t.SetText(s)
        t.SetLayer(layer)
        t.SetPosition(at(x, y))
        t.SetTextSize(pcbnew.VECTOR2I(pcbnew.FromMM(size), pcbnew.FromMM(size)))
        t.SetTextThickness(pcbnew.FromMM(size * 0.15))
        if rot:
            t.SetTextAngle(pcbnew.EDA_ANGLE(rot, pcbnew.DEGREES_T))
        if layer == pcbnew.B_SilkS:
            t.SetMirrored(True)
        b.Add(t)

    # label side, the way Pololu prints it: pin names over the row, product and logo text
    for i, lab in enumerate(spec["labels"]):
        text(lab, hx + 2.54 * i, hy - 2.4, 0.7, pcbnew.B_SilkS, 90)
    text("Pololu", 0, -h + 2.0, 1.2, pcbnew.B_SilkS)
    text(spec["title"], 0, -h + 4.0, 0.9, pcbnew.B_SilkS)

    pcbnew.SaveBoard(path, b)
    txt = open(path, encoding="utf-8").read()
    # green mask: pcbnew can't set the colour from Python, the STEP export reads it from the
    # file. It comes out a pale green whatever is asked for, recolour() fixes that afterwards.
    if "(stackup" not in txt:
        core = spec["th"] - 0.09
        stack = (
            '\n\t\t(stackup\n'
            '\t\t\t(layer "F.SilkS" (type "Top Silk Screen") (color "White"))\n'
            '\t\t\t(layer "F.Paste" (type "Top Solder Paste"))\n'
            '\t\t\t(layer "F.Mask" (type "Top Solder Mask") (color "#1F8A2EFF") (thickness 0.01))\n'
            '\t\t\t(layer "F.Cu" (type "copper") (thickness 0.035))\n'
            f'\t\t\t(layer "dielectric 1" (type "core") (color "#1F8A2EFF") (thickness {core:.3f})'
            ' (material "FR4") (epsilon_r 4.5) (loss_tangent 0.02))\n'
            '\t\t\t(layer "B.Cu" (type "copper") (thickness 0.035))\n'
            '\t\t\t(layer "B.Mask" (type "Bottom Solder Mask") (color "#1F8A2EFF") (thickness 0.01))\n'
            '\t\t\t(layer "B.Paste" (type "Bottom Solder Paste"))\n'
            '\t\t\t(layer "B.SilkS" (type "Bottom Silk Screen") (color "White"))\n'
            '\t\t\t(copper_finish "ENIG")\n'
            '\t\t\t(dielectric_constraints no)\n'
            '\t\t)')
        i = txt.index("(setup") + len("(setup")
        open(path, "w", encoding="utf-8").write(txt[:i] + stack + txt[i:])
    print(f"\n@@RESULT {len(list(b.GetFootprints()))}", flush=True)


# Where each model sits on the carrier's regulator footprint (footprint frame, mm, y down): the
# module centre, from the bodies in modules.json. z: module underside on the 2.54 mm spacer.
# Only the recommended D24V10F5 is shown; the D36V28F5 is attached hidden, tick it in KiCad's
# 3D settings to look at that one instead.
ON_CARRIER = [("pololu-d24v10f5", "D24V10F5", True), ("pololu-d36v28f5", "D36V28F5", False)]
REF = "5V Buck Converter"
BOARD = os.path.join(HERE, "luxdmx-carrier.kicad_pcb")


def attach():
    import json
    import pcbnew
    with open(os.path.join(HERE, "modules.json")) as f:
        m = json.load(f)["modules"]["buck-module-universal"]
    ox, oy = m["pcb"]["width"] / 2.0, m["pcb"]["length"] / 2.0
    bodies = {bd["name"]: bd for bd in m["bodies"]}
    b = pcbnew.LoadBoard(BOARD)
    fp = next(f for f in b.GetFootprints() if f.GetReference() == REF)
    fp.Models().clear()
    for name, body, show in ON_CARRIER:
        bd = bodies[body]
        cx = (bd["x0"] + bd["x1"]) / 2 - ox
        cy = (bd["y0"] + bd["y1"]) / 2 - oy
        mdl = pcbnew.FP_3DMODEL()
        mdl.m_Filename = "${KIPRJMOD}/3dmodels/" + name + ".step"
        mdl.m_Offset = pcbnew.VECTOR3D(cx, -cy, 2.54)      # 3D offset is y-up
        mdl.m_Show = show
        fp.Models().push_back(mdl)
        print(f"  {name}: offset {cx:+.2f} {-cy:+.2f} 2.54  {'shown' if show else 'hidden'}")
    pcbnew.SaveBoard(BOARD, b)
    print("\n@@RESULT ok", flush=True)


POLOLU_MASK = (0.10, 0.40, 0.15)    # Pololu's mid green, as sRGB in the STEP
POLOLU_CORE = (0.08, 0.32, 0.12)


def recolour(step):
    """kicad-cli writes the soldermask and board body in a washed-out green (it lightens the
    stackup colour for its 3D look, the same thing Feuerwerk's export_modules.py corrects).
    The only green-dominant colours in these files are the module board's own, so set those
    to Pololu's green: lighter one = mask, darker one = body."""
    txt = open(step).read()
    pat = re.compile(r"COLOUR_RGB\('([^']*)',\s*([-+0-9.Ee]+),\s*([-+0-9.Ee]+),\s*([-+0-9.Ee]+)\)")
    greens = sorted({tuple(float(m.group(i)) for i in (2, 3, 4)) for m in pat.finditer(txt)
                     if float(m.group(3)) > float(m.group(2)) + 0.2
                     and float(m.group(3)) > float(m.group(4)) + 0.15}, key=lambda c: c[1])
    if not greens:
        return 0
    new = {greens[-1]: POLOLU_MASK}
    for g in greens[:-1]:
        new[g] = POLOLU_CORE

    def sub(m):
        key = tuple(float(m.group(i)) for i in (2, 3, 4))
        if key in new:
            return "COLOUR_RGB('%s',%.4f,%.4f,%.4f)" % ((m.group(1),) + new[key])
        return m.group(0)
    open(step, "w").write(pat.sub(sub, txt))
    return len(greens)


def main():
    if "--attach" in sys.argv:
        return attach()
    if "--stage" in sys.argv:
        i = sys.argv.index("--stage")
        return build(sys.argv[i + 1], sys.argv[i + 2])
    os.makedirs(WORK, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    names = [a for a in sys.argv[1:] if a in MODULES] or list(MODULES)
    for name in names:
        pcb = os.path.join(WORK, name + ".kicad_pcb")
        r = subprocess.run([sys.executable, os.path.abspath(__file__), "--stage", name, pcb],
                           capture_output=True, text=True)
        m = re.search(r"@@RESULT (\d+)", r.stdout)
        if not m:
            raise SystemExit(f"{name}:\n{r.stdout[-700:]}\n{r.stderr[-700:]}")
        step = os.path.join(OUT, name + ".step")
        subprocess.run(["kicad-cli", "pcb", "export", "step", pcb, "-o", step, "--force",
                        "--subst-models", "--include-pads", "--include-silkscreen",
                        "--include-soldermask", "--no-optimize-step",
                        "--user-origin", f"{CX}x{CY}mm"], capture_output=True, text=True)
        ok = os.path.exists(step)
        if ok:
            recolour(step)
        print(f"{name:18s} {m.group(1)} parts -> 3dmodels/{name}.step"
              + (f"  {os.path.getsize(step)//1024} kB" if ok else "  EXPORT FAILED"))
    r = subprocess.run([sys.executable, os.path.abspath(__file__), "--attach"],
                       capture_output=True, text=True)
    print("\n".join(l for l in r.stdout.splitlines() if l.startswith("  ")) or r.stderr[-500:])
    return 0


if __name__ == "__main__":
    sys.exit(main())
