#!/usr/bin/env python
"""Extract enclosure-relevant geometry from the live KiCad PCB and emit board_params.scad.

Run after any board change so the OpenSCAD enclosure tracks the real connector / LED
positions:

    python extract_case_params.py            # reads ../lumigate.kicad_pcb
    python extract_case_params.py path.pcb    # or an explicit file

Everything is emitted in a BOARD-LOCAL frame whose origin is the board outline's
min corner (KiCad min-X / min-Y).  u = +X (toward the XLR / RJ45 / right wall),
v = +Y (toward the USB-C / bottom wall, i.e. KiCad's downward Y).  Z is up
(component side).  Component *heights* are not stored in the PCB, so those live as
design parameters in lumigate_case.scad, not here.
"""
import math, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
PCB = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "..", "lumigate.kicad_pcb")
OUT = os.path.join(HERE, "board_params.scad")


# ---------------------------------------------------------------- s-expr parser
def parse(s):
    n = len(s)

    def rd(i):
        out = []
        while i < n:
            c = s[i]
            if c == '(':
                sub, i = rd(i + 1); out.append(sub)
            elif c == ')':
                return out, i + 1
            elif c.isspace():
                i += 1
            elif c == '"':
                j = i + 1; buf = []
                while j < n and s[j] != '"':
                    if s[j] == '\\':
                        buf.append(s[j + 1]); j += 2
                    else:
                        buf.append(s[j]); j += 1
                out.append('"' + ''.join(buf)); i = j + 1
            else:
                j = i
                while j < n and not s[j].isspace() and s[j] not in '()':
                    j += 1
                out.append(s[i:j]); i = j
        return out, i

    return rd(1)[0]


def name(node):
    return node[0] if node and isinstance(node[0], str) else None


def getval(node, key):
    for c in node:
        if isinstance(c, list) and name(c) == key:
            return c
    return None


def s(x):
    return x[1:] if isinstance(x, str) and x.startswith('"') else x


# ---------------------------------------------------------------- load + index
src = open(PCB, encoding="utf-8").read()
tree = parse(src)
fps = [c for c in tree if isinstance(c, list) and name(c) == 'footprint']


def ref_of(fp):
    for c in fp:
        if isinstance(c, list) and name(c) == 'property' and s(c[1]) == 'Reference':
            return s(c[2])
    return None


def at_of(fp):
    a = getval(fp, 'at')
    return float(a[1]), float(a[2]), (float(a[3]) if len(a) > 3 else 0.0)


def by_ref(ref):
    return next((f for f in fps if ref_of(f) == ref), None)


def xf(px, py, ang, lx, ly):
    """KiCad footprint-local -> board coords (CW rotation, Y-down)."""
    r = math.radians(ang)
    return (px + lx * math.cos(r) + ly * math.sin(r),
            py - lx * math.sin(r) + ly * math.cos(r))


def fp_layer_bbox(fp, layers, kinds=('fp_line', 'fp_rect', 'fp_poly')):
    px, py, ang = at_of(fp)
    xs, ys = [], []
    for c in fp:
        if isinstance(c, list) and name(c) in kinds:
            lay = getval(c, 'layer')
            if lay and s(lay[1]) in layers:
                for sub in c:
                    if isinstance(sub, list) and name(sub) in ('start', 'end', 'center', 'xy'):
                        bx, by = xf(px, py, ang, float(sub[1]), float(sub[2]))
                        xs.append(bx); ys.append(by)
    return (min(xs), min(ys), max(xs), max(ys)) if xs else None


# ---------------------------------------------------------------- board outline
def outline_rect():
    for c in tree:
        if isinstance(c, list) and name(c) == 'gr_rect':
            lay = getval(c, 'layer')
            if lay and s(lay[1]) == 'Edge.Cuts':
                a, b = getval(c, 'start'), getval(c, 'end')
                return float(a[1]), float(a[2]), float(b[1]), float(b[2])
    raise SystemExit("No Edge.Cuts gr_rect found - board outline is not a simple rectangle; "
                     "extend extract_case_params.py to handle the real outline.")


x0, y0, x1, y1 = outline_rect()
ORIGX, ORIGY = min(x0, x1), min(y0, y1)
BW, BH = abs(x1 - x0), abs(y1 - y0)


def U(bx):
    return bx - ORIGX


def V(by):
    return by - ORIGY


# ---------------------------------------------------------------- ESP32 overhang
esp = by_ref('U1')
fab = fp_layer_bbox(esp, ('F.Fab', 'B.Fab'))           # module body
esp_left = max(0.0, -U(fab[0]))                          # how far body crosses min-X edge

# ---------------------------------------------------------------- XLR (J1)
xlr = by_ref('J1')
px, py, ang = at_of(xlr)
sig, screws = [], []
for c in xlr:
    if isinstance(c, list) and name(c) == 'pad':
        at = getval(c, 'at'); lx, ly = float(at[1]), float(at[2])
        bx, by = xf(px, py, ang, lx, ly)
        if c[2] == 'np_thru_hole':
            drill = getval(c, 'drill')
            screws.append((U(bx), V(by), float(drill[1])))
        if s(c[1]) in ('1', '2', '3'):
            sig.append((bx, by))
ax = sum(a for a, b in sig) / len(sig)
ay = sum(b for a, b in sig) / len(sig)
xlr_u, xlr_v = U(ax), V(ay)
screws.sort(key=lambda h: h[1])                          # by v

# ---------------------------------------------------------------- RJ45 (J3) / USB-C (J2)
rj = by_ref('J3'); rb = fp_layer_bbox(rj, ('F.CrtYd', 'B.CrtYd'))
ub = by_ref('J2'); ubb = fp_layer_bbox(ub, ('F.CrtYd', 'B.CrtYd'))
rj_v = (V(rb[1]) + V(rb[3])) / 2; rj_span = abs(rb[3] - rb[1])
us_u = (U(ubb[0]) + U(ubb[2])) / 2; us_span = abs(ubb[2] - ubb[0])

# ---------------------------------------------------------------- LEDs
leds = []
for ref in ('D2', 'D3', 'D4', 'D5', 'D6'):
    fp = by_ref(ref)
    if fp:
        bx, by, _ = at_of(fp)
        leds.append((U(bx), V(by)))
leds.sort()
led_v = sum(v for u, v in leds) / len(leds)


# ---------------------------------------------------------------- emit .scad
def arr(xs):
    return "[" + ", ".join(f"{x:.3f}" for x in xs) + "]"


with open(OUT, "w", encoding="utf-8") as f:
    w = f.write
    w("// board_params.scad - AUTO-GENERATED by extract_case_params.py. DO NOT EDIT BY HAND.\n")
    w(f"// source: {os.path.basename(PCB)}   frame: u=+X(right), v=+Y(USB-C side), origin=board min corner\n\n")
    w(f"board_w = {BW:.3f};   // board outline width  (u)\n")
    w(f"board_h = {BH:.3f};   // board outline height (v)\n\n")
    w(f"esp_overhang_left = {esp_left:.3f};  // ESP32 module body past the left (u=0) edge -> must be enclosed\n\n")
    w("// XLR / DMX (J1) - exits the RIGHT (+X) wall\n")
    w(f"xlr_axis_u = {xlr_u:.3f};\n")
    w(f"xlr_axis_v = {xlr_v:.3f};\n")
    w(f"xlr_screw_v = {arr([h[1] for h in screws])};   // wall screw v-positions (from connector mounting holes)\n")
    w(f"xlr_screw_drill = {screws[0][2]:.3f};            // mounting-hole drill in the PCB (ref)\n\n")
    w("// Ethernet RJ45 (J3) - exits the RIGHT (+X) wall\n")
    w(f"rj45_center_v = {rj_v:.3f};\n")
    w(f"rj45_span_v   = {rj_span:.3f};   // body width along v\n\n")
    w("// USB-C (J2) - exits the BOTTOM (+Y) wall\n")
    w(f"usbc_center_u = {us_u:.3f};\n")
    w(f"usbc_span_u   = {us_span:.3f};   // body width along u\n\n")
    w("// Status LEDs (top side, emit +Z) - light holes in the cover\n")
    w(f"led_u = {arr([u for u, v in leds])};\n")
    w(f"led_v = {led_v:.3f};\n")

print("wrote", OUT)
print(f"  board {BW:.2f} x {BH:.2f} mm, ESP32 overhang {esp_left:.2f} mm")
print(f"  XLR axis (u,v)=({xlr_u:.2f},{xlr_v:.2f}) screws v={[round(h[1],2) for h in screws]}")
print(f"  RJ45 v={rj_v:.2f} span {rj_span:.2f}; USB-C u={us_u:.2f} span {us_span:.2f}")
print(f"  LEDs u={[round(u,2) for u,v in leds]} v={led_v:.2f}")
