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

  MP1584EN   22 x 17 mm board (ProtoSupplies product photos, front and back): see MODULES.
  SIPs       KiCad's R-78E model and gen_regulator_marks.py's K7805, see ON_CARRIER.

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
        title="D24V10F5", mask=(0.10, 0.40, 0.15)),
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
        title="D36V28F5", mask=(0.10, 0.40, 0.15)),
    # The common 22 x 17 mm MP1584EN board (HiLetgo, AZDelivery, ProtoSupplies...). Layout
    # measured off ProtoSupplies' top-view photos (front and back, about 20 px/mm): OUT on the
    # left, IN on the right, + at the top with square pads, two 0.1 in holes per corner. Front:
    # trimmer top left, MP1584EN (SOIC-8 EP) right of centre, grey 4R7 inductor bottom left, SS34
    # (SMA) under the IC, 1206 caps standing at both ends, 0603/0805 small parts round the IC.
    # Back: no parts, OUT-/IN-/OUT+/IN+ and an arrow pointing from IN to OUT.
    "mp1584en-module": dict(
        w=22.0, h=17.0, th=1.0,
        parts=[
            ("Potentiometer_SMD:Potentiometer_Bourns_TC33X_Vertical", -4.65, -6.70, 0),
            ("Package_SO:SOIC-8-1EP_3.9x4.9mm_P1.27mm_EP2.29x3mm", 3.08, -0.25, 90),
            ("Inductor_SMD:L_Coilcraft_XAL7030-472", -4.40, 2.50, 0),
            ("Diode_SMD:D_SMA", 3.56, 5.50, 0),
            (C12, -9.50, -0.25, 90), (C12, 9.50, -0.25, 90),
            (C08, -6.00, -3.20, 0), (C08, -2.56, -3.20, 0),
            (R06, 1.07, -6.95, 0), (R06, 1.07, -5.47, 0), (R06, 3.80, -5.47, 0),
            (C06, 4.30, -6.95, 0), (C06, 7.00, -6.95, 0),
            (R06, 7.00, -3.70, 90), (R06, 5.90, -0.50, 90), (C06, 7.00, 2.50, 90),
        ],
        header=None,
        holes=[],
        # (x, y, square): + pads square, as on the board
        pairs=[(-9.5, -6.9, True), (-9.5, -4.35, True), (9.5, -6.9, True), (9.5, -4.35, True),
               (-9.5, 4.35, False), (-9.5, 6.9, False), (9.5, 4.35, False), (9.5, 6.9, False)],
        silk_front=[("+", -7.25, -7.05, 0.9, 0), ("-", -6.90, 6.85, 0.9, 0), ("MH", -3.75, 7.75, 0.8, 180)],
        silk_circles=[(-7.25, -7.05, 0.65), (-6.90, 6.85, 0.65)],
        silk_back=[("OUT+", -5.6, -5.6, 1.1, 0), ("IN+", 5.6, -5.6, 1.1, 0),
                   ("OUT-", -5.6, 5.6, 1.1, 0), ("IN-", 5.6, 5.6, 1.1, 0)],
        arrow=(4.6, -4.6, 0.0),          # back silk: from x0 to x1 at y, head at x1
        labels=[], title=None, mask=(0.13, 0.58, 0.30)),
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
    if spec["header"]:
        hx, hy, n = spec["header"]
        hd = place(HDR5, "J1", hx, hy, 90)
        hd.Flip(hd.GetPosition(), pcbnew.FLIP_DIRECTION_TOP_BOTTOM)
        xs = sorted(round(pcbnew.ToMM(p.GetPosition().x) - CX, 2) for p in hd.Pads())
        want = [round(hx + 2.54 * i, 2) for i in range(n)]
        if xs != want or not hd.IsFlipped():
            raise SystemExit(f"{name}: header pads at {xs}, wanted {want}")

    if spec.get("pairs"):
        pairs = pcbnew.FOOTPRINT(b)
        pairs.SetReference("T")
        pairs.Reference().SetVisible(False)
        pairs.Value().SetVisible(False)
        b.Add(pairs)
        for i, (x, y, sq) in enumerate(spec["pairs"]):
            p = pcbnew.PAD(pairs)
            p.SetNumber(str(i + 1))
            p.SetAttribute(pcbnew.PAD_ATTRIB_PTH)
            p.SetShape(pcbnew.PAD_SHAPE_RECT if sq else pcbnew.PAD_SHAPE_CIRCLE)
            p.SetSize(pcbnew.VECTOR2I(pcbnew.FromMM(1.7), pcbnew.FromMM(1.7)))
            p.SetDrillSize(pcbnew.VECTOR2I(pcbnew.FromMM(0.9), pcbnew.FromMM(0.9)))
            p.SetLayerSet(p.PTHMask())
            p.SetPosition(at(x, y))
            pairs.Add(p)

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
    if spec["header"]:
        for i, lab in enumerate(spec["labels"]):
            text(lab, hx + 2.54 * i, hy - 2.4, 0.7, pcbnew.B_SilkS, 90)
    if spec["title"]:
        text("Pololu", 0, -h + 2.0, 1.2, pcbnew.B_SilkS)
        text(spec["title"], 0, -h + 4.0, 0.9, pcbnew.B_SilkS)
    for t_, x, y, sz, rot in spec.get("silk_front", []):
        text(t_, x, y, sz, pcbnew.F_SilkS, rot)
    for t_, x, y, sz, rot in spec.get("silk_back", []):
        text(t_, x, y, sz, pcbnew.B_SilkS, rot)

    def seg(a, c, layer, wd=0.15):
        s_ = pcbnew.PCB_SHAPE(b)
        s_.SetShape(pcbnew.SHAPE_T_SEGMENT)
        s_.SetLayer(layer)
        s_.SetStart(at(*a))
        s_.SetEnd(at(*c))
        s_.SetWidth(pcbnew.FromMM(wd))
        b.Add(s_)
    for x, y, r in spec.get("silk_circles", []):
        cc = pcbnew.PCB_SHAPE(b)
        cc.SetShape(pcbnew.SHAPE_T_CIRCLE)
        cc.SetLayer(pcbnew.F_SilkS)
        cc.SetCenter(at(x, y))
        cc.SetEnd(at(x + r, y))
        cc.SetWidth(pcbnew.FromMM(0.12))
        b.Add(cc)
    if spec.get("arrow"):
        x0, x1, y = spec["arrow"]
        seg((x0, y), (x1, y), pcbnew.B_SilkS, 0.35)
        seg((x1, y), (x1 + 1.0, y - 0.8), pcbnew.B_SilkS, 0.35)
        seg((x1, y), (x1 + 1.0, y + 0.8), pcbnew.B_SilkS, 0.35)

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


# Every regulator the spot takes, as it sits on the carrier's regulator footprint.
# Footprint frame (the module seen from outside, mm, y DOWN, as in the .kicad_mod), offset of the
# model origin, rotation about z, and whether KiCad shows it. The 3D offset KiCad stores is
# y-up, attach() flips the sign. Origins:
#   module boards (ours):  module centre, z = underside of the module board
#   SIP parts:             pin 1, z = carrier surface (KiCad's own convention for THT parts)
# z: Pololu modules ride on the 2.54 mm header spacer; the MP1584 board lies flat on its lands
# on 0.1 mm of solder; SIPs sit on their own standoffs.
# The recommended D24V10F5 is the one shown. Tick another in KiCad's 3D settings (and untick
# the D24) to look at that one. Positions follow modules.json: rows A/B, the corner lands.
KICAD3D = "${KICAD10_3DMODEL_DIR}/Converter_DCDC.3dshapes/"
ON_CARRIER = [
    # key, model files (main + printed markings overlay), (x, y, z), rot z, shown
    ("d24v10f5", ["pololu-d24v10f5.step"], (-7.88, -8.90, 2.54), 0, True),
    ("d36v28f5", ["pololu-d36v28f5.step"], (-10.43, -7.61, 2.54), 0, False),
    ("mp1584en", ["mp1584en-module.step", "mp1584en-module-marks.step"], (0.0, 0.0, 0.1), 180, False),
    ("r78e5.0-1.0", [KICAD3D + "Converter_DCDC_RECOM_R-78E-0.5_THT.step", "recom-r78e-marks.step"],
     (-7.88, -1.27, 0.0), 0, False),
    ("k7805-1000r3", ["mornsun-k7805-1000r3.step"], (-7.88, -1.27, 0.0), 0, False),
]
REF = "5V Buck Converter"
BOARD = os.path.join(HERE, "luxdmx-carrier.kicad_pcb")


def model_path(f):
    return f if f.startswith("${") else "${KIPRJMOD}/3dmodels/" + f


def attach(only=None, board=BOARD):
    """Hang all variants on the footprint. only=<key>: show that one alone (for the per-variant
    GLB exports), otherwise the shown flags above."""
    import pcbnew
    b = pcbnew.LoadBoard(board)
    fp = next(f for f in b.GetFootprints() if f.GetReference() == REF)
    fp.Models().clear()
    for key, files, (x, y, z), rot, show in ON_CARRIER:
        for fn in files:
            if not fn.startswith("${") and not os.path.exists(os.path.join(OUT, fn)):
                print(f"  {key}: {fn} missing, run tools/gen_regulator_marks.py")
                continue
            mdl = pcbnew.FP_3DMODEL()
            mdl.m_Filename = model_path(fn)
            mdl.m_Offset = pcbnew.VECTOR3D(x, -y, z)
            mdl.m_Rotation = pcbnew.VECTOR3D(0, 0, rot)
            mdl.m_Show = (key == only) if only else show
            fp.Models().push_back(mdl)
        print(f"  {key:12s} offset {x:+.2f} {y:+.2f} {z:.2f} rot {rot:3d}  "
              f"{'shown' if ((key == only) if only else show) else 'hidden'}")
    pcbnew.SaveBoard(board, b)
    print("\n@@RESULT ok", flush=True)


def export_variants():
    """One GLB + STEP per regulator, placed in carrier-board coordinates exactly as a plain
    `kicad-cli pcb export glb luxdmx-carrier.kicad_pcb` places the whole board (default origin),
    with nothing but the regulator in it. For the video: drop it into the scene as is."""
    import shutil
    d = os.path.join(HERE, "work", "variants")
    os.makedirs(d, exist_ok=True)
    out = os.path.join(HERE, "work", "placed")        # not tracked: derived, and big
    os.makedirs(out, exist_ok=True)
    shutil.copy(os.path.join(HERE, "luxdmx-carrier.kicad_pro"), d)
    link = os.path.join(d, "3dmodels")
    if not os.path.exists(link):
        os.symlink(OUT, link)
    env = dict(os.environ, KICAD10_3DMODEL_DIR="/usr/share/kicad/3dmodels")
    for key, *_ in ON_CARRIER:
        pcb = os.path.join(d, "luxdmx-carrier.kicad_pcb")
        shutil.copy(BOARD, pcb)
        subprocess.run([sys.executable, os.path.abspath(__file__), "--attach-only", key, pcb],
                       capture_output=True, text=True)
        for fmt in ("glb", "step"):
            o = os.path.join(out, f"regulator-{key}.{fmt}")
            subprocess.run(["kicad-cli", "pcb", "export", fmt, pcb, "-o", o, "--force",
                            "--subst-models", "--no-board-body",
                            # the filter can't take the space in the reference; "5V*" alone
                            # would pull in "5V IN" too
                            "--component-filter", REF.replace(" ", "?")],
                           capture_output=True, text=True, env=env)
        print(f"  work/placed/regulator-{key}.glb/.step")


def recolour(step, mask):
    """kicad-cli writes the soldermask and board body in a washed-out green (it lightens the
    stackup colour for its 3D look, the same thing Feuerwerk's export_modules.py corrects).
    The only green-dominant colours in these files are the module board's own, so set those
    to the board's real green: lighter one = mask, darker one = body."""
    txt = open(step).read()
    pat = re.compile(r"COLOUR_RGB\('([^']*)',\s*([-+0-9.Ee]+),\s*([-+0-9.Ee]+),\s*([-+0-9.Ee]+)\)")
    greens = sorted({tuple(float(m.group(i)) for i in (2, 3, 4)) for m in pat.finditer(txt)
                     if float(m.group(3)) > float(m.group(2)) + 0.2
                     and float(m.group(3)) > float(m.group(4)) + 0.15}, key=lambda c: c[1])
    if not greens:
        return 0
    core = tuple(round(v * 0.8, 4) for v in mask)
    new = {greens[-1]: mask}
    for g in greens[:-1]:
        new[g] = core

    def sub(m):
        key = tuple(float(m.group(i)) for i in (2, 3, 4))
        if key in new:
            return "COLOUR_RGB('%s',%.4f,%.4f,%.4f)" % ((m.group(1),) + new[key])
        return m.group(0)
    open(step, "w").write(pat.sub(sub, txt))
    return len(greens)


def main():
    if "--attach-only" in sys.argv:
        i = sys.argv.index("--attach-only")
        return attach(only=sys.argv[i + 1], board=sys.argv[i + 2])
    if "--attach" in sys.argv:
        return attach()
    if "--variants" in sys.argv:
        return export_variants()
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
            recolour(step, MODULES[name]["mask"])
        print(f"{name:18s} {m.group(1)} parts -> 3dmodels/{name}.step"
              + (f"  {os.path.getsize(step)//1024} kB" if ok else "  EXPORT FAILED"))
    r = subprocess.run([sys.executable, os.path.abspath(__file__), "--attach"],
                       capture_output=True, text=True)
    print("\n".join(l for l in r.stdout.splitlines() if l.startswith("  ")) or r.stderr[-500:])
    export_variants()
    return 0


if __name__ == "__main__":
    sys.exit(main())
