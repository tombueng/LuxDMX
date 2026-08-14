#!/usr/bin/env python3
"""Widen every land on the board so it takes whatever part is in the drawer.

The board is hand-built, so the lands should not insist on one exact package. Four changes,
all of them purely geometric, no net changes:

**Chip lands.** The 1206 hand-solder lands ran from 0.90 to 2.20 mm off centre, which meant
an 0805 caught only 0.10 mm of pad per side and an 0603 fell in the gap. The universal land
runs 0.30 to 2.30 instead, so every cap from 0402 up lands on copper:

    0402  cap 0.25 - 0.50      0603  cap 0.50 - 0.80
    0805  cap 0.60 - 1.00      1206  cap 1.10 - 1.60

1210 fits as well, its 2.5 mm width just overhangs the 1.8 mm pad, which solders fine by
hand. The gap between the pads drops to 0.60 mm, about what a stock 0603 land has, so
bridging is no more likely than usual. What it does give up is reflow: nothing self-aligns
on a land this long. That is the trade, and this board is hand-built anyway.

**TVS lands.** Same idea but out to 2.90 mm, which is what a DO-214AC needs. So the six TVS
positions now take SOD-123, SOD-123F, SOD-123FL, an SMAJ in SMA, or a plain 1206. The six
sit 6.51 mm apart, which leaves 0.71 mm between two neighbouring lands.

**DMX headers.** Drill 1.00 -> 1.20 mm and pad 1.70 -> 1.80, which is what the 2.54 mm screw
terminals want (Phoenix MPT 1.10, TE 282834 1.10, Xinya XY308 1.20). A 0.64 mm header pin
still solders in a 1.20 mm hole. The rows also move 1.20 mm towards the board edge, from
y 60.20 to 59.00, because a horizontal 2.54 terminal is 6.60 mm deep and only had 6.90 mm
between the edge and the RS-485 modules. At 59.00 the body runs 55.85 to 62.45: 0.15 mm past
the board edge, which is normal for an edge connector, and 0.45 mm clear of the modules.

**Pixel buffer.** DIP-20 -> SOIC-20W. The through-hole buffer was 26.0 mm long and its two
pin rows sat square across the path from the input terminal to the fuse, on both layers. The
SOIC is 13.3 mm and has no back-side pins at all, which gives the input rail its narrowest
stretch back and frees the space under the raised display. Same pinout, pins 1 to 20.

**Blade fuse holder.** Placed OUTSIDE the board outline, wired to the same two nets as the
polyfuse, for you to drag into place. Keystone 3568, mini blade, 16.6 x 7.3 mm, and it is the
one of the automotive holders in the KiCad library that ships a 3D model.

**Power and pixel terminals.** 2.60 mm round pads become 3.60 x 3.30 mm rounded rectangles on
the same 1.30 mm drill. Soldering a wire straight into a hole is awkward; soldering it onto a
3.6 x 3.3 mm pad is not. The screw terminal still fits, the hole did not move. Along the
5.08 mm pitch that leaves 1.48 mm between pads.

Run:  python tools/rework_lands.py [--check]
"""
import os
import re
import shutil
import subprocess
import sys

KFP = "/usr/share/kicad/footprints"


def _project_dir():
    d = os.path.dirname(os.path.abspath(__file__))
    for _ in range(3):
        if os.path.exists(os.path.join(d, "luxdmx-carrier.kicad_pcb")):
            return d
        d = os.path.dirname(d)
    return os.path.dirname(os.path.abspath(__file__))


HERE = _project_dir()
BOARD = os.path.join(HERE, "luxdmx-carrier.kicad_pcb")
LIB = os.path.join(HERE, "footprints", "LuxDMXCarrierCustom.pretty")
DMX_Y_OLD, DMX_Y_NEW = 60.20, 59.45

CHIP_DESCR = (
    "Universal hand-solder chip land, copper 0.30 to {out:.2f} mm off centre. Takes {sizes}. "
    "Gap between the pads is 0.60 mm, about what a stock 0603 land has. Hand soldering only: "
    "the land is far longer than any of the parts, so nothing self-aligns in reflow.")


def chip_land(name, half, descr, tags):
    """Two rectangles, copper from 0.30 to `half` mm off centre, 1.80 mm wide."""
    c = (0.30 + half) / 2
    w = half - 0.30
    tick, edge = half + 0.15, 1.20
    return f"""(footprint "{name}"
  (version 20240108)
  (generator "luxdmx-carrier-rework_lands")
  (layer "F.Cu")
  (descr "{descr}")
  (tags "{tags}")
  (attr smd)
  (fp_text reference "REF**" (at 0 -2.100) (layer "F.SilkS") (effects (font (size 0.8 0.8) (thickness 0.15))))
  (fp_text value "{name}" (at 0 2.100) (layer "F.Fab") (effects (font (size 0.8 0.8) (thickness 0.15))))
  (fp_line (start {-tick:.3f} {-edge:.3f}) (end {tick:.3f} {-edge:.3f}) (stroke (width 0.12) (type solid)) (layer "F.SilkS"))
  (fp_line (start {-tick:.3f} {edge:.3f}) (end {tick:.3f} {edge:.3f}) (stroke (width 0.12) (type solid)) (layer "F.SilkS"))
  (fp_line (start {-tick:.3f} {-edge:.3f}) (end {-tick:.3f} {edge:.3f}) (stroke (width 0.12) (type solid)) (layer "F.SilkS"))
  (fp_line (start {tick:.3f} {-edge:.3f}) (end {tick:.3f} {edge:.3f}) (stroke (width 0.12) (type solid)) (layer "F.SilkS"))
  (fp_rect (start {-half-0.30:.3f} -1.400) (end {half+0.30:.3f} 1.400) (stroke (width 0.05) (type solid)) (fill none) (layer "F.CrtYd"))
  (fp_rect (start {-half:.3f} -0.900) (end {half:.3f} 0.900) (stroke (width 0.10) (type solid)) (fill none) (layer "F.Fab"))
  (pad "1" smd rect (at {-c:.3f} 0) (size {w:.3f} 1.800) (layers "F.Cu" "F.Paste" "F.Mask"))
  (pad "2" smd rect (at {c:.3f} 0) (size {w:.3f} 1.800) (layers "F.Cu" "F.Paste" "F.Mask"))
)
"""


def derive(src_lib, src_name, new_name, size, drill, shape, descr_extra, grow=0.0):
    """Copy a stock footprint and rewrite only its pads, keeping silk, fab and the 3D model."""
    txt = open(os.path.join(KFP, src_lib, src_name + ".kicad_mod"), encoding="utf-8").read()
    txt = txt.replace(f'(footprint "{src_name}"', f'(footprint "{new_name}"', 1)
    # lambda, not a replacement string: descr_extra starts with a digit and "\1" + "1.20"
    # reads as group 11
    txt = re.sub(r'\(descr "', lambda m: m.group(0) + descr_extra + " ", txt, count=1)

    def pad(m):
        body = m.group(0)
        # `grow` stretches the pad towards local +y only, which is the board edge at the
        # rotation both terminals are placed at, and walks the hole back by half of it so the
        # drill does not move. Wires get soldered from outside, so the copper wants to reach
        # the edge, not sit a millimetre and a half short of it.
        # In KiCad `at` is the HOLE and the drill's `offset` moves the SHAPE relative to it,
        # not the other way round. Shifting `at` as well walks the hole off the pitch and
        # leaves the copper where it was, which is exactly backwards.
        h, off = size[1] + grow, grow / 2
        body = re.sub(r"\(size [\d.]+ [\d.]+\)", f"(size {size[0]:.2f} {h:.2f})", body)
        body = re.sub(r"\(drill [\d.]+\)",
                      f"(drill {drill:.2f} (offset 0 {off:.3f}))" if grow
                      else f"(drill {drill:.2f})", body)
        body = re.sub(r'(\(pad "\d+" thru_hole )\w+', r"\g<1>" + shape, body)
        if shape == "roundrect" and "roundrect_rratio" not in body:
            body = body.rstrip()[:-1].rstrip() + "\n\t\t(roundrect_rratio 0.150000)\n\t)"
        return body

    return re.sub(r'\(pad "\d+" thru_hole .*?\n\t\)', pad, txt, flags=re.S)


def override_pads(txt, spec):
    """Per-pad size and shape offset, applied after derive().

    The three pads of a pixel terminal do not carry the same current: V+ and GND carry the
    load, DATA carries a signal. Making DATA narrow is what buys V+ and GND the width to
    reach 10 A - at 5.08 mm pitch three equal 3.60 mm pads left only a 2.4 mm entry, which
    is 6.1 A. DATA stays full length so a wire still solders to it.
    """
    def one(m):
        body = m.group(0)
        num = re.search(r'\(pad "(\d+)"', body).group(1)
        if num not in spec:
            return body
        sx, sy, ox, oy = spec[num]
        body = re.sub(r"\(size [\d.]+ [\d.]+\)", f"(size {sx:.2f} {sy:.2f})", body)
        body = re.sub(r"\(drill ([\d.]+)( \(offset [^)]*\))?\)",
                      lambda d: f"(drill {float(d.group(1)):.2f} "
                                f"(offset {ox:.3f} {oy:.3f}))", body)
        return body
    return re.sub(r'\(pad "\d+" thru_hole .*?\n\t\)', one, txt, flags=re.S)


def write_libs():
    os.makedirs(LIB, exist_ok=True)
    out = {}
    out["chip-universal"] = chip_land(
        "chip-universal", 2.30,
        CHIP_DESCR.format(out=2.30, sizes="0402, 0603, 0805 and 1206, and a 1210 whose 2.5 mm "
                                          "width overhangs the 1.8 mm pad"),
        "resistor capacitor universal handsolder 0402 0603 0805 1206")
    out["chip-universal-tvs"] = chip_land(
        "chip-universal-tvs", 2.90,
        CHIP_DESCR.format(out=2.90, sizes="0603 to 1206, SOD-123 / SOD-123F / SOD-123FL, and "
                                          "DO-214AC (SMA), whose feet reach 2.80 mm"),
        "tvs diode universal handsolder SOD-123 SMA DO-214AC 1206")
    dmx = derive(
        "Connector_PinHeader_2.54mm.pretty", "PinHeader_1x03_P2.54mm_Vertical",
        # oval, not circle: KiCad forces a circular pad square, so an elongated one silently
        # came back 3.85 x 3.85 instead of 3.85 x 1.90 and shorted its neighbours' clearance
        "header-1x03-P2.54-terminal", (1.80, 1.80), 1.20, "oval",
        "1.20 mm drill so a 2.54 mm screw terminal fits as well as a pin header, plus the "
        "three unplated 1.10 mm holes the Phoenix MPT 0,5/3-2,54 needs for its mounting pegs. "
        "TE 282834-3, Xinya XY308-2.54-3P and a plain pin header ignore those holes.")
    # The pegs sit on the SAME side as the wire entry, not behind it, which is not something
    # the footprint's outline tells you: its body is symmetric across the pin row. Local +x
    # is towards the board edge at this rotation, so that is where they go, at board y 56.91
    # with the edge at 56.00. That is also why the row sits at 59.45 rather than 59.00: any
    # further out and the peg holes hang off the board.
    pegs = "\n".join(
        f'  (pad "" np_thru_hole circle (at 2.540 {i * 2.54:.3f}) (size 1.100 1.100)'
        f' (drill 1.100) (layers "F&B.Cu" "*.Mask"))' for i in range(3))
    # elongated inwards, local -x, because local +x is where the Phoenix pegs sit at y 56.91
    # and there is no room between them and the board edge. 1.90 wide leaves 0.64 mm between
    # pads at 2.54 pitch; the pad ends 1.09 mm short of the peg holes.
    dmx = override_pads(dmx, {n: (3.85, 1.90, -1.025, 0.0) for n in ("1", "2", "3")})
    out["header-1x03-P2.54-terminal"] = dmx.rstrip()[:-1].rstrip() + "\n" + pegs + "\n)\n"
    # grow: how far the copper still has to travel to reach 0.5 mm off the board edge. Both
    # rows now sit 3.35 mm short of it, the pixel row at y 131.00 against the bottom edge at
    # 136.00 and the 12/24 V input at x 95.50 against the left edge at 90.50, so both get the
    # same 2.85. Not flush with the edge: copper at a milled outline burrs unless the fab
    # castellates it, which is a different process.
    for n, src, grow in ((2, "TerminalBlock_Phoenix_MKDS-3-2-5.08_1x02_P5.08mm_Horizontal", 2.85),
                         (3, "TerminalBlock_Phoenix_MKDS-3-3-5.08_1x03_P5.08mm_Horizontal", 2.85)):
        wide = {"1": (4.80, 3.30 + grow, 0.0, grow / 2),
                "2": ((2.00 if n == 3 else 4.80), 3.30 + grow, 0.0, grow / 2),
                "3": (4.80, 3.30 + grow, 0.0, grow / 2)}
        out[f"terminal-1x0{n}-P5.08-bigpad"] = derive(
            "TerminalBlock_Phoenix.pretty", src, f"terminal-1x0{n}-P5.08-bigpad",
            (3.60, 3.30), 1.30, "roundrect",
            "Pads enlarged and stretched out to 0.5 mm off the board edge so a wire can be "
            "soldered flat onto the copper from outside instead of threaded into the hole. "
            "V+ and GND are 4.80 mm wide for 10 A at a 20 K rise; DATA is 2.00, it carries a "
            "signal, and narrowing it is what leaves V+ the width. Drill and pitch unchanged, "
            "the screw terminal still fits.", grow)
        out[f"terminal-1x0{n}-P5.08-bigpad"] = override_pads(
            out[f"terminal-1x0{n}-P5.08-bigpad"], wide)
    for name, txt in out.items():
        open(os.path.join(LIB, name + ".kicad_mod"), "w", encoding="utf-8").write(txt)
    return list(out)


# ---------------------------------------------------------------- board stages

PHOENIX = ("${KICAD10_3DMODEL_DIR}/TerminalBlock_Phoenix.3dshapes/"
           "TerminalBlock_Phoenix_MPT-0,5-3-2.54_1x03_P2.54mm_Horizontal.step")


def stage_buffer():
    """DIP-20 -> SOIC-20W, on the through-hole part's body centre so nothing else shifts."""
    import pcbnew
    b = pcbnew.LoadBoard(BOARD)
    old = next((f for f in b.GetFootprints() if "74AHCT541" in f.GetValue()), None)
    if old is None:
        print("\n@@RESULT kein Puffer gefunden", flush=True)
        return
    if "SOIC" in old.GetFPIDAsString():
        # it belongs on the back: the SOIC is 2.75 mm tall and the ESP32 module sits on
        # 2.54 mm of header plastic, so on the front, under the module, it fouls it by 0.2
        if not old.IsFlipped():
            rot = old.GetOrientation()
            old.Flip(old.GetPosition(), pcbnew.FLIP_DIRECTION_LEFT_RIGHT)
            old.SetOrientation(rot)
            pcbnew.SaveBoard(BOARD, b)
            print("\n@@RESULT schon SMD, auf die Rueckseite gelegt", flush=True)
            return
        print("\n@@RESULT schon SMD und hinten", flush=True)
        return
    bb = old.GetBoundingBox(False, False)
    cx = (pcbnew.ToMM(bb.GetLeft()) + pcbnew.ToMM(bb.GetRight())) / 2
    cy = (pcbnew.ToMM(bb.GetTop()) + pcbnew.ToMM(bb.GetBottom())) / 2
    rot, nets = old.GetOrientation(), {p.GetNumber(): p.GetNet() for p in old.Pads()}
    ref, val = old.GetReference(), old.GetValue()
    rt = old.Reference()
    tpos, tlayer, tvis = rt.GetPosition(), rt.GetLayer(), rt.IsVisible()

    new = pcbnew.FootprintLoad(os.path.join(KFP, "Package_SO.pretty"),
                               "SOIC-20W_7.5x12.8mm_P1.27mm")
    if new is None:
        raise SystemExit("SOIC-20W nicht gefunden")
    b.Add(new)
    new.SetOrientation(rot)
    new.SetPosition(pcbnew.VECTOR2I(pcbnew.FromMM(cx), pcbnew.FromMM(cy)))
    new.SetReference(ref)
    new.SetValue(val)
    new.Reference().SetPosition(tpos)
    new.Reference().SetLayer(tlayer)
    new.Reference().SetVisible(tvis)
    for p in new.Pads():
        n = nets.get(p.GetNumber())
        if n is not None:
            p.SetNet(n)
    b.Remove(old)
    pcbnew.SaveBoard(BOARD, b)
    print(f"\n@@RESULT SOIC-20W bei ({cx:.2f}, {cy:.2f})", flush=True)


def stage_extras():
    """The blade fuse holder outside the outline, and the terminal model on the DMX rows."""
    import pcbnew
    b = pcbnew.LoadBoard(BOARD)
    e = [s for s in b.GetDrawings() if s.GetLayer() == pcbnew.Edge_Cuts]
    xr = max(pcbnew.ToMM(v) for s in e for v in (s.GetStart().x, s.GetEnd().x))
    yt = min(pcbnew.ToMM(v) for s in e for v in (s.GetStart().y, s.GetEnd().y))

    made = "schon da"
    if not any("Fuseholder" in f.GetFPIDAsString() for f in b.GetFootprints()):
        fh = pcbnew.FootprintLoad(os.path.join(KFP, "Fuse.pretty"),
                                  "Fuseholder_Blade_Mini_Keystone_3568")
        if fh is None:
            raise SystemExit("Sicherungshalter nicht gefunden")
        b.Add(fh)
        fh.SetPosition(pcbnew.VECTOR2I(pcbnew.FromMM(xr + 14.0), pcbnew.FromMM(yt + 8.0)))
        fh.SetReference("F1")
        fh.SetValue("Blade fuse holder, alternative to the polyfuse")
        for p in fh.Pads():
            n = b.FindNet("V_PIX_IN" if p.GetNumber() == "1" else "V_PIX")
            if n is not None:
                p.SetNet(n)
        made = f"gesetzt bei ({xr + 14.0:.1f}, {yt + 8.0:.1f}), ausserhalb der Kante {xr:.1f}"

    n = 0
    for f in b.GetFootprints():
        if not f.GetReference().startswith("DMX"):
            continue
        f.Models().clear()
        m = pcbnew.FP_3DMODEL()
        m.m_Filename = PHOENIX
        m.m_Show = True
        # 270 with the row shift, not 90: at 90 the wire entry pointed into the board. The
        # body is symmetric across the pin row so the bounding box cannot tell you which way
        # it faces; turning it 180 degrees also reverses the row, hence the 5.08 back along
        # it. Same extents either way, x -3.10..3.10 and y -1.50..6.58, opposite entry.
        m.m_Rotation.z = 270.0
        m.m_Offset.y = -5.08
        f.Models().push_back(m)
        n += 1
    pcbnew.SaveBoard(BOARD, b)
    print(f"\n@@RESULT Halter {made}, Klemmenmodell auf {n} DMX-Reihen", flush=True)


def stage_swap():
    import pcbnew
    b = pcbnew.LoadBoard(BOARD)

    plan = []
    for f in b.GetFootprints():
        fid = f.GetFPIDAsString().split(":")[-1]
        ref = f.GetReference()
        if fid.startswith("D_1206"):
            plan.append((f, "chip-universal-tvs", None))
        elif "1206" in fid:
            plan.append((f, "chip-universal", None))
        elif ref.startswith("DMX") and ("PinHeader_1x03" in fid or fid.startswith("header-")):
            plan.append((f, "header-1x03-P2.54-terminal", DMX_Y_NEW))
        # match the reworked names too, so re-running after a footprint change actually
        # replaces them instead of quietly skipping every one
        elif fid.startswith(("TerminalBlock_Phoenix_MKDS-3-3", "terminal-1x03-P5.08")):
            plan.append((f, "terminal-1x03-P5.08-bigpad", None))
        elif fid.startswith(("TerminalBlock_Phoenix_MKDS-3-2", "terminal-1x02-P5.08")):
            plan.append((f, "terminal-1x02-P5.08-bigpad", None))

    done = []
    for old, newname, newy in plan:
        new = pcbnew.FootprintLoad(LIB, newname)
        if new is None:
            raise SystemExit(f"{newname} nicht ladbar")
        pos, rot, flip = old.GetPosition(), old.GetOrientation(), old.IsFlipped()
        nets = {p.GetNumber(): p.GetNet() for p in old.Pads()}
        ref, val = old.GetReference(), old.GetValue()
        rt, vt = old.Reference(), old.Value()
        keep = [(t.GetPosition(), t.GetLayer(), t.IsVisible(), t.GetTextHeight(),
                 t.GetTextThickness()) for t in (rt, vt)]

        b.Add(new)
        new.SetOrientation(rot)
        if flip:
            new.Flip(new.GetPosition(), pcbnew.FLIP_DIRECTION_LEFT_RIGHT)
            new.SetOrientation(rot)
        new.SetPosition(pos if newy is None
                        else pcbnew.VECTOR2I(pos.x, pcbnew.FromMM(newy)))
        new.SetReference(ref)
        new.SetValue(val)
        for t, (tp, tl, tv, th, tw) in zip((new.Reference(), new.Value()), keep):
            if newy is not None:
                # by the actual distance moved, not a constant: re-running this on a board
                # whose rows already sit at 59.00 must not shift the labels a second time
                tp = pcbnew.VECTOR2I(tp.x, tp.y - (pos.y - pcbnew.FromMM(newy)))
            t.SetPosition(tp)
            t.SetLayer(tl)
            t.SetVisible(tv)
            t.SetTextSize(pcbnew.VECTOR2I(th, th))
            t.SetTextThickness(tw)
        for p in new.Pads():
            n = nets.get(p.GetNumber())
            if n is not None:
                p.SetNet(n)
        b.Remove(old)
        done.append((ref, newname))

    pcbnew.SaveBoard(BOARD, b)
    print("\n@@RESULT " + str(len(done)), flush=True)


def stage_trim_edge():
    """Pull any terminal pad back that hangs over the board edge.

    The pads are grown a fixed amount in the footprint, but how much room a terminal actually
    has depends on where it was placed. Growing 2.85 mm is right where the row sits 3.35 mm
    from the edge and two violations where someone moved it closer. So the growth is clamped
    here, against the real outline, after placement.
    """
    import pcbnew
    b = pcbnew.LoadBoard(BOARD)
    e = [s for s in b.GetDrawings() if s.GetLayer() == pcbnew.Edge_Cuts]
    L = min(pcbnew.ToMM(v) for s in e for v in (s.GetStart().x, s.GetEnd().x))
    R = max(pcbnew.ToMM(v) for s in e for v in (s.GetStart().x, s.GetEnd().x))
    T = min(pcbnew.ToMM(v) for s in e for v in (s.GetStart().y, s.GetEnd().y))
    B = max(pcbnew.ToMM(v) for s in e for v in (s.GetStart().y, s.GetEnd().y))
    KEEP = 0.5

    n = 0
    for f in b.GetFootprints():
        if "terminal-1x0" not in f.GetFPIDAsString():
            continue
        for p in f.Pads():
            bb = p.GetBoundingBox()
            over = max(L + KEEP - pcbnew.ToMM(bb.GetLeft()),
                       pcbnew.ToMM(bb.GetRight()) - (R - KEEP),
                       T + KEEP - pcbnew.ToMM(bb.GetTop()),
                       pcbnew.ToMM(bb.GetBottom()) - (B - KEEP))
            if over <= 0.005:
                continue
            s, o = p.GetSize(), p.GetOffset()
            sy = pcbnew.ToMM(s.y) - over
            oy = pcbnew.ToMM(o.y) - over / 2
            p.SetSize(pcbnew.VECTOR2I(s.x, pcbnew.FromMM(sy)))
            p.SetOffset(pcbnew.VECTOR2I(o.x, pcbnew.FromMM(oy)))
            n += 1
            print(f"  {f.GetReference()[:22]:22s} Pad {p.GetNumber()}: {over:.2f} mm "
                  f"zurueckgenommen, jetzt {sy:.2f} mm lang")
    pcbnew.SaveBoard(BOARD, b)
    print(f"\n@@RESULT {n}", flush=True)


def stage_report():
    import pcbnew
    b = pcbnew.LoadBoard(BOARD)
    kinds = {}
    for f in b.GetFootprints():
        kinds.setdefault(f.GetFPIDAsString().split(":")[-1], []).append(f.GetReference())
    for k in sorted(kinds):
        if k.startswith(("chip-", "header-1x03-P2.54-terminal", "terminal-1x0")):
            print(f"  {len(kinds[k]):2d} x {k}")
    b.BuildConnectivity()
    print(f"\n@@RESULT {b.GetConnectivity().GetUnconnectedCount(True)}", flush=True)


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
        return {"swap": stage_swap, "report": stage_report,
                "buffer": stage_buffer, "extras": stage_extras,
                "trim": stage_trim_edge}[sys.argv[-1]]()

    names = write_libs()
    print(f"Footprints: {', '.join(names)}")
    if "--check" in sys.argv:
        return 0
    bak = BOARD + ".before-rework"
    if not os.path.exists(bak):
        shutil.copy(BOARD, bak)
    print(f"{sub('swap')} Positionen getauscht")
    print(f"Puffer: {sub('buffer')}")
    print(f"Extras: {sub('extras')}")
    print(f"Kante:  {sub('trim')} Pads gekuerzt")
    print(f"{sub('report')} Verbindungen offen (Neuverdrahtung folgt)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
