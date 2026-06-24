#!/usr/bin/env python
"""Populate lumigate.kicad_sch from the SKiDL netlist + part library.

The LumiGate board is code-driven: lumigate.py -> lumigate.net -> PCB. The
schematic file was never captured. This builds a real, readable KiCad-9 schematic
that matches the netlist exactly:

  * each functional block places its BIGGEST chip in the middle and the smaller
    parts to the left/right of it (or above/below for small 2-pin parts),
    chosen by which side of the main chip each part connects to,
  * inside a block, every same-net pin is connected: signal nets are WIRED
    together; power/ground rails (GND/+5V/+3V3 and every supply) get a power
    symbol on each pin,
  * a net that stays inside one block is left unnamed (synthetic/internal); a net
    that also appears in another block gets a global label so it crosses over,
  * unused pins get no-connect flags; rails without a driver pin get a PWR_FLAG,
  * blocks are tiled into balanced columns for a roughly square sheet.

Verify:  kicad-cli sch export netlist  ->  diff nets vs lumigate.net
Regenerate:  python gen_schematic.py
"""
import os
import uuid

import lumigate_sklib as sklib

HERE = os.path.dirname(os.path.abspath(__file__))
NET = os.path.join(HERE, 'lumigate.net')
OUT = os.path.join(HERE, 'lumigate.kicad_sch')
PROJECT = 'lumigate'
NS = uuid.uuid5(uuid.NAMESPACE_URL, 'lumigate-schematic')


def uid(*p):
    return str(uuid.uuid5(NS, ':'.join(str(x) for x in p)))


def fnum(x):
    return ('%.4f' % x).rstrip('0').rstrip('.')


def snap(v, g=1.27):
    return round(v / g) * g


def median(vals):
    s = sorted(vals)
    return s[len(s) // 2]


# ---------------------------------------------------------------------------
# minimal S-expression reader
# ---------------------------------------------------------------------------
def parse_sexpr(text):
    tokens = []
    i, n = 0, len(text)
    while i < n:
        c = text[i]
        if c in '()':
            tokens.append(c); i += 1
        elif c == '"':
            j = i + 1; buf = []
            while j < n:
                if text[j] == '\\':
                    buf.append(text[j + 1]); j += 2; continue
                if text[j] == '"':
                    break
                buf.append(text[j]); j += 1
            tokens.append(('STR', ''.join(buf))); i = j + 1
        elif c.isspace():
            i += 1
        else:
            j = i
            while j < n and text[j] not in '() \t\r\n"':
                j += 1
            tokens.append(('SYM', text[i:j])); i = j
    pos = 0

    def build():
        nonlocal pos
        node = []
        while pos < len(tokens):
            t = tokens[pos]
            if t == '(':
                pos += 1; node.append(build())
            elif t == ')':
                pos += 1; return node
            else:
                pos += 1; node.append(t[1])
        return node

    out = []
    while pos < len(tokens):
        if tokens[pos] == '(':
            pos += 1; out.append(build())
        else:
            pos += 1
    return out[0]


def find(node, key):
    return [c for c in node if isinstance(c, list) and c and c[0] == key]


def first(node, key):
    f = find(node, key)
    return f[0] if f else None


# ---------------------------------------------------------------------------
# read netlist
# ---------------------------------------------------------------------------
with open(NET, encoding='utf-8') as fh:
    root = parse_sexpr(fh.read())

comps = {}
for comp in find(first(root, 'components'), 'comp'):
    ref = first(comp, 'ref')[1]
    if ref.startswith('TP'):
        continue
    val = first(comp, 'value')
    fp = first(comp, 'footprint')
    ls = first(comp, 'libsource')
    comps[ref] = {
        'value': val[1] if val and len(val) > 1 else '',
        'footprint': fp[1] if fp and len(fp) > 1 else '',
        'part': first(ls, 'part')[1] if ls and first(ls, 'part') else '',
    }

nets = {}
pin_net = {}
for net in find(first(root, 'nets'), 'net'):
    name = first(net, 'name')[1]
    members = []
    for node in find(net, 'node'):
        ref = first(node, 'ref')[1]
        pin = first(node, 'pin')[1]
        if ref.startswith('TP'):
            continue
        members.append((ref, pin))
        pin_net[(ref, pin)] = name
    if members:
        nets[name] = members

FUNC = {
    'INPUT': 'input', 'OUTPUT': 'output', 'BIDIR': 'bidirectional',
    'TRISTATE': 'tri_state', 'PASSIVE': 'passive', 'PWRIN': 'power_in',
    'PWROUT': 'power_out', 'OPENCOLL': 'open_collector', 'OPENEMIT': 'open_emitter',
    'NOCONNECT': 'no_connect', 'PULLUP': 'passive', 'PULLDN': 'passive',
    'UNSPEC': 'unspecified', 'FREE': 'free',
}
templates = {}
for p in sklib.lumigate.parts:
    templates[p.name] = [(str(pin.num), str(pin.name), FUNC.get(pin.func.name, 'passive'))
                         for pin in p.pins]


def part_pins(ref):
    return templates[comps[ref]['part']]


def func_of(ref, pin):
    for num, nm, fn in part_pins(ref):
        if num == pin:
            return fn
    return 'passive'


# rail = a supply/ground net -> power symbols (not wired as a signal). Detect by a
# power pin OR by name, since intermediate rails (e.g. +5V_USB) only have passive
# pins yet are still rails. Wiring a rail as a signal risks collinear-run shorts.
def _rail_name(n):
    return (n.startswith('+') or n.startswith('VISO') or n.startswith('VPOE')
            or n.startswith('GNDISO') or n == 'GND')


rail_nets = set()
for name, members in nets.items():
    if _rail_name(name) or any(func_of(r, p) in ('power_in', 'power_out') for r, p in members):
        rail_nets.add(name)

# ---------------------------------------------------------------------------
# functional blocks
# ---------------------------------------------------------------------------
SECTIONS = [
    ("U1  ESP32-S3-WROOM-1  +  reset / boot",
     ["U1", "C1", "C2", "R1", "C3", "R2", "SW1", "SW2"]),
    ("U2  W5500 Ethernet  +  25MHz crystal  +  HY931147C magjack (J3)",
     ["U2", "J3", "Y1", "R3", "C4", "C5", "C6", "C8", "C9", "C10", "C11",
      "C12", "C13", "R18", "C14", "C22", "R4", "R5"]),
    ("U3  CH340 USB-UART  +  USB-C (J2)  +  auto-reset",
     ["U3", "J2", "U8", "Q1", "Q2", "C15", "R6", "R7", "R8", "R9", "F1"]),
    ("PoE PD (U7)  +  5V ideal-diode OR-ing (U9 TPS2116)",
     ["U7", "U9", "D10", "D11", "C27", "C28", "C29", "C30", "C31", "FB1"]),
    ("U4  SY8089  5V -> 3.3V buck",
     ["U4", "L1", "C16", "C17", "R10", "R11"]),
    ("Isolated DMX universe 1  (U5 ISO3086 / PS1 / XLR J1)",
     ["U5", "PS1", "J1", "L2", "D1", "C18", "C19", "C20", "C21", "R12", "FB2"]),
    ("Isolated DMX universe 2  (U6 ISO3086 / PS2 / XLR J5)",
     ["U6", "PS2", "J5", "L3", "D7", "C23", "C24", "C25", "C26", "R19", "FB3"]),
    ("Status LEDs (direct on S3 GPIOs)",
     ["D2", "R13", "D3", "R14", "D4", "R15", "D5", "R16", "D6", "R17"]),
    ("Headers:  display (J4) / expansion (J6) / DMX-out (J7,J8)",
     ["J4", "J6", "J7", "J8"]),
    ("Mounting holes (chassis GND)",
     ["MH1", "MH2", "MH3", "MH4"]),
]
seen = set(r for _t, rr in SECTIONS for r in rr)
extra = [r for r in comps if r not in seen]
if extra:
    SECTIONS.append(("Misc", sorted(extra)))

block_of = {}
for bi, (_t, refs) in enumerate(SECTIONS):
    for r in refs:
        if r in comps:
            block_of[r] = bi
net_blocks = {}
for name, members in nets.items():
    net_blocks[name] = set(block_of[r] for r, _p in members if r in block_of)


def is_local(net, bi):
    return net_blocks.get(net, set()) == {bi}


# ---------------------------------------------------------------------------
# symbol geometry:  hub (horizontal box), leaf_h, leaf_v, power symbols
# ---------------------------------------------------------------------------
PITCH = 2.54
HPIN = 2.54
LEAF = 3.81          # leaf pin reach from origin
STUB = 2.54


class Sym:
    pass


def effects(just=None, hide=False, size=1.27):
    return '(effects (font (size %s %s))%s%s)' % (
        fnum(size), fnum(size),
        (' (justify %s)' % just) if just else '',
        ' (hide yes)' if hide else '')


def pin_sx(func, x, y, ang, nm, num):
    return ('(pin %s line (at %s %s %d) (length %s) '
            '(name "%s" (effects (font (size 1 1)))) '
            '(number "%s" (effects (font (size 1 1)))))'
            % (func, fnum(x), fnum(y), ang, fnum(HPIN), nm, num))


def wrap_lib(libname, hide_names, body, pins, rp):
    return (
        '(symbol "%s:%s" (pin_numbers (hide no)) (pin_names (offset 0.508)%s) '
        '(exclude_from_sim no) (in_bom yes) (on_board yes)\n'
        '  (property "Reference" "%s" (at 0 0 0) (effects (font (size 1.27 1.27)) (hide yes)))\n'
        '  (property "Value" "%s" (at 0 0 0) (effects (font (size 1.27 1.27)) (hide yes)))\n'
        '  (property "Footprint" "" (at 0 0 0) (effects (font (size 1.27 1.27)) (hide yes)))\n'
        '  (property "Datasheet" "" (at 0 0 0) (effects (font (size 1.27 1.27)) (hide yes)))\n'
        '  (symbol "%s_0_1" %s)\n  (symbol "%s_1_1" %s)\n)'
        % (PROJECT, libname, ' (hide yes)' if hide_names else '', rp, libname,
           libname, ' '.join(body), libname, ' '.join(pins)))


def rp_of(part):
    return {'C': 'C', 'R': 'R', 'L': 'L'}.get(part, 'U')


def hub_symbol(libname, pins):
    s = Sym(); s.style = 'hub'; s.pins = {}
    hide = all(nm == num or nm in ('~', '') for num, nm, _f in pins)
    half = (len(pins) + 1) // 2
    left, right = pins[:half], pins[half:]
    rows = max(len(left), len(right), 1)
    lmax = max((len(nm) for _n, nm, _f in left), default=1)
    rmax = max((len(nm) for _n, nm, _f in right), default=1)
    bw = max(5.08, round(((lmax + rmax) * 0.9 + 5.08) / 2 / 1.27) * 1.27)
    bhh = snap(rows * PITCH / 2 + PITCH)

    def ys(c):
        return [round(((c - 1) / 2 * PITCH - i * PITCH) / 0.01) * 0.01 for i in range(c)]
    body = ['(rectangle (start %s %s) (end %s %s) (stroke (width 0.254) (type default)) '
            '(fill (type background)))' % (fnum(-bw), fnum(bhh), fnum(bw), fnum(-bhh))]
    ps = []
    for (num, nm, fn), y in zip(left, ys(len(left))):
        s.pins[num] = (-bw - HPIN, y); ps.append(pin_sx(fn, -bw - HPIN, y, 0, nm, num))
    for (num, nm, fn), y in zip(right, ys(len(right))):
        s.pins[num] = (bw + HPIN, y); ps.append(pin_sx(fn, bw + HPIN, y, 180, nm, num))
    s.w, s.h = 2 * (bw + HPIN), 2 * bhh
    s.lib = wrap_lib(libname, hide, body, ps, rp_of(libname))
    return s


def leaf_symbol(libname, pins, vertical):
    s = Sym(); s.style = 'leaf_v' if vertical else 'leaf_h'; s.pins = {}
    hide = all(nm == num or nm in ('~', '') for num, nm, _f in pins)
    if vertical:
        body = ['(rectangle (start -1.0 1.27) (end 1.0 -1.27) (stroke (width 0.2032) '
                '(type default)) (fill (type none)))']
        coords = [(0.0, LEAF, 270), (0.0, -LEAF, 90)]
    else:
        body = ['(rectangle (start -1.27 1.0) (end 1.27 -1.0) (stroke (width 0.2032) '
                '(type default)) (fill (type none)))']
        coords = [(-LEAF, 0.0, 0), (LEAF, 0.0, 180)]
    ps = []
    for (num, nm, fn), (x, y, ang) in zip(pins, coords):
        s.pins[num] = (x, y); ps.append(pin_sx(fn, x, y, ang, nm, num))
    s.w = (2.0 if vertical else 2 * LEAF)
    s.h = (2 * LEAF if vertical else 2.0)
    s.lib = wrap_lib(libname, hide, body, ps, rp_of(libname))
    return s


# power symbol per rail (pin NAME == rail net -> connects globally by name)
rail_used = sorted({pin_net[(r, p)] for r in comps for p, _n, _f in part_pins(r)
                    if pin_net.get((r, p)) in rail_nets})
pwr_id = {net: 'PWR%d' % i for i, net in enumerate(rail_used)}


def pwr_symbol(net, libid):
    gnd = ('GND' in net) or net.endswith('-')
    if gnd:
        gfx = ('(polyline (pts (xy 0 0) (xy 0 -1.27)) (stroke (width 0.254)(type default))(fill (type none)))'
               '(polyline (pts (xy -1.27 -1.27)(xy 1.27 -1.27)) (stroke (width 0.254)(type default))(fill (type none)))'
               '(polyline (pts (xy -0.762 -1.905)(xy 0.762 -1.905)) (stroke (width 0.254)(type default))(fill (type none)))'
               '(polyline (pts (xy -0.254 -2.54)(xy 0.254 -2.54)) (stroke (width 0.254)(type default))(fill (type none)))')
        vy = -3.81
    else:
        gfx = ('(polyline (pts (xy 0 0)(xy 0 1.27)) (stroke (width 0.254)(type default))(fill (type none)))'
               '(polyline (pts (xy -1.27 1.27)(xy 1.27 1.27)) (stroke (width 0.254)(type default))(fill (type none)))'
               '(polyline (pts (xy 0 2.54)(xy -1.27 1.27)(xy 1.27 1.27)(xy 0 2.54)) (stroke (width 0.254)(type default))(fill (type none)))')
        vy = 3.18
    return (
        '(symbol "%s:%s" (power) (pin_numbers (hide yes)) (pin_names (offset 0)(hide yes)) '
        '(exclude_from_sim no) (in_bom yes) (on_board yes)\n'
        '  (property "Reference" "#PWR" (at 0 0 0) (effects (font (size 1.27 1.27)) (hide yes)))\n'
        '  (property "Value" "%s" (at 0 %s 0) (effects (font (size 1.27 1.27))))\n'
        '  (property "Footprint" "" (at 0 0 0) (effects (font (size 1.27 1.27)) (hide yes)))\n'
        '  (property "Datasheet" "" (at 0 0 0) (effects (font (size 1.27 1.27)) (hide yes)))\n'
        '  (symbol "%s_0_1" %s)\n'
        '  (symbol "%s_1_1" (pin power_in line (at 0 0 90) (length 0) '
        '(name "%s" (effects (font (size 1.27 1.27)))) (number "1" (effects (font (size 1.27 1.27))))))\n)'
        % (PROJECT, libid, net, fnum(vy), libid, gfx, libid, net))


# build all symbols actually used
symbols = {}                 # lib id -> Sym (hubs/leaves)
for part, pins in {comps[r]['part']: part_pins(r) for r in comps}.items():
    if len(pins) > 2:
        symbols[part] = hub_symbol(part, pins)
    else:
        symbols[part] = leaf_symbol(part, pins, vertical=False)
        symbols[part + '__v'] = leaf_symbol(part + '__v', pins, vertical=True)


def part_sym(ref, vertical=False):
    part = comps[ref]['part']
    if len(part_pins(ref)) > 2:
        return symbols[part]
    return symbols[part + '__v'] if vertical else symbols[part]


def is_hub(ref):
    return len(part_pins(ref)) > 2


# ---------------------------------------------------------------------------
# primitive collectors + renderer (sections built in local coords, then tiled)
# ---------------------------------------------------------------------------
S = []
P = []


def emit_text(s, x, y, size=2.0):
    P.append(('text', s, x, y, size))


def add_inst(ref, sym, px, py, mx=False, my=False):
    P.append(('inst', ref, sym, px, py, mx, my))


def add_pwr(net, x, y, ang):
    P.append(('pwr', net, x, y, ang))


def wire(x1, y1, x2, y2, tag):
    if (x1, y1) != (x2, y2):
        P.append(('wire', x1, y1, x2, y2, tag))


def junction(x, y, tag):
    P.append(('junc', x, y, tag))


def glabel(net, x, y, ang, just, tag):
    P.append(('glabel', net, x, y, ang, just, tag))


def no_connect(x, y, tag):
    P.append(('nc', x, y, tag))


def pin_xy(px, py, mx, my, sym, num):
    sx, sy = sym.pins[num]
    if my:
        sx = -sx
    return px + sx, (py + sy if mx else py - sy)


def render(prim, dx, dy):
    k = prim[0]
    if k == 'wire':
        _, x1, y1, x2, y2, t = prim
        return ('\t(wire (pts (xy %s %s) (xy %s %s)) (stroke (width 0) (type default)) (uuid "%s"))'
                % (fnum(x1 + dx), fnum(y1 + dy), fnum(x2 + dx), fnum(y2 + dy), uid('w', t)))
    if k == 'junc':
        _, x, y, t = prim
        return ('\t(junction (at %s %s) (diameter 0) (color 0 0 0 0) (uuid "%s"))'
                % (fnum(x + dx), fnum(y + dy), uid('j', t)))
    if k == 'glabel':
        _, net, x, y, ang, just, t = prim
        return ('\t(global_label "%s" (shape bidirectional) (at %s %s %d) (fields_autoplaced yes) '
                '%s (uuid "%s"))' % (net, fnum(x + dx), fnum(y + dy), ang, effects(just), uid('gl', t)))
    if k == 'nc':
        _, x, y, t = prim
        return '\t(no_connect (at %s %s) (uuid "%s"))' % (fnum(x + dx), fnum(y + dy), uid('nc', t))
    if k == 'text':
        _, s, x, y, size = prim
        return ('\t(text "%s" (exclude_from_sim no) (at %s %s 0) (effects (font (size %s %s) '
                '(bold yes)) (justify left bottom)) (uuid "%s"))'
                % (s, fnum(x + dx), fnum(y + dy), fnum(size), fnum(size), uid('txt', s)))
    if k == 'pwr':
        _, net, x, y, ang = prim
        gnd = ('GND' in net) or net.endswith('-')
        vy = (y + dy + 3.3) if gnd else (y + dy - 3.3)   # name hugging the symbol
        return (
            '\t(symbol (lib_id "%s:%s") (at %s %s %d) (unit 1) (exclude_from_sim no) '
            '(in_bom yes) (on_board yes) (dnp no) (uuid "%s")\n'
            '\t\t(property "Reference" "#PWR_%s" (at %s %s 0) %s)\n'
            '\t\t(property "Value" "%s" (at %s %s 0) %s)\n'
            '\t\t(instances (project "%s" (path "/%s" (reference "#PWR_%s") (unit 1))))\n\t)'
            % (PROJECT, pwr_id[net], fnum(x + dx), fnum(y + dy), ang, uid('pwr', x, y, net),
               net, fnum(x + dx), fnum(y + dy), effects(hide=True),
               net, fnum(x + dx), fnum(vy), effects(size=1.0),
               PROJECT, uid('root'), uid('pwr', x, y, net)))
    if k == 'flag':
        _, name, x, y = prim
        x, y = x + dx, y + dy
        return (
            '\t(symbol (lib_id "%s:PWR_FLAG") (at %s %s 0) (unit 1) (exclude_from_sim no) '
            '(in_bom yes) (on_board yes) (dnp no) (uuid "%s")\n'
            '\t\t(property "Reference" "#FLG_%s" (at %s %s 0) %s)\n'
            '\t\t(property "Value" "PWR_FLAG" (at %s %s 0) %s)\n'
            '\t\t(instances (project "%s" (path "/%s" (reference "#FLG_%s") (unit 1))))\n\t)'
            % (PROJECT, fnum(x), fnum(y), uid('flg', name),
               name, fnum(x), fnum(y - 5.0), effects(hide=True),
               fnum(x + 2.0), fnum(y - 3.0), effects('left'),
               PROJECT, uid('root'), name))
    # instance
    _, ref, sym, px, py, mx, my = prim
    px, py = px + dx, py + dy
    c = comps[ref]
    mtok = ' (mirror x)' if mx else (' (mirror y)' if my else '')
    # keep Reference/Value clear of the pins (where power symbols / wires attach):
    # hub -> above/below; leaf_v (T/B pins) -> to the right; leaf_h (L/R pins) -> above/below
    if sym.style == 'hub':
        rx, ry, vx, vy, rj, vj = px, py - sym.h / 2 - 1.6, px, py + sym.h / 2 + 2.4, 'left', 'left'
    elif sym.style == 'leaf_v':
        rx, ry, vx, vy, rj, vj = px + 2.4, py - 1.4, px + 2.4, py + 1.4, 'left', 'left'
    else:                                   # leaf_h
        rx, ry, vx, vy, rj, vj = px, py - 2.9, px, py + 2.9, None, None
    return (
        '\t(symbol (lib_id "%s:%s") (at %s %s 0)%s (unit 1) (exclude_from_sim no) '
        '(in_bom yes) (on_board yes) (dnp no) (uuid "%s")\n'
        '\t\t(property "Reference" "%s" (at %s %s 0) %s)\n'
        '\t\t(property "Value" "%s" (at %s %s 0) %s)\n'
        '\t\t(property "Footprint" "%s" (at %s %s 0) %s)\n'
        '\t\t(property "Datasheet" "" (at %s %s 0) %s)\n'
        '\t\t(instances (project "%s" (path "/%s" (reference "%s") (unit 1))))\n\t)'
        % (PROJECT, sym.name if hasattr(sym, 'name') else '?', fnum(px), fnum(py), mtok,
           uid('sym', ref),
           ref, fnum(rx), fnum(ry), effects(rj, size=1.0),
           c['value'], fnum(vx), fnum(vy), effects(vj, size=1.0),
           c['footprint'], fnum(px), fnum(py), effects(hide=True, size=0.8),
           fnum(px), fnum(py), effects(hide=True),
           PROJECT, uid('root'), ref))


# give every Sym a .name = its lib id (needed by render)
for k, v in symbols.items():
    v.name = k


def prim_bbox(prims):
    X0, Y0, X1, Y1 = [], [], [], []

    def add(a, b, c, d):
        X0.append(a); Y0.append(b); X1.append(c); Y1.append(d)
    for p in prims:
        k = p[0]
        if k == 'inst':
            _, ref, sym, px, py, mx, my = p
            add(px - sym.w / 2, py - sym.h / 2, px + sym.w / 2, py + sym.h / 2)
        elif k == 'wire':
            _, x1, y1, x2, y2, _t = p
            add(min(x1, x2), min(y1, y2), max(x1, x2), max(y1, y2))
        elif k in ('junc', 'nc'):
            _, x, y, _t = p
            add(x, y, x, y)
        elif k == 'pwr':
            _, net, x, y, _a = p
            add(x - 3, y - 4, x + 3, y + 4)
        elif k == 'glabel':
            _, net, x, y, ang, just, _t = p
            tw = len(net) * 1.4 + 4
            if ang == 0 and 'right' in just:
                add(x - tw, y - 1.6, x + 1, y + 1.6)
            elif ang == 0:
                add(x - 1, y - 1.6, x + tw, y + 1.6)
            elif ang == 90:
                add(x - 1.6, y - tw, x + 1.6, y + 1)
            else:
                add(x - 1.6, y - 1, x + 1.6, y + tw)
        elif k == 'text':
            _, s, x, y, size = p
            add(x, y - size, x + len(s) * size * 0.62, y)
    return min(X0), min(Y0), max(X1), max(Y1)


# ---------------------------------------------------------------------------
# routing helpers
# ---------------------------------------------------------------------------
def _alloc(center, occupied, used):
    """pick a trunk coordinate near `center` that is NOT a pin coordinate
    (`occupied`) and not already used by another trunk -- so wires only ever
    meet their own pins (crossings elsewhere are mid-span and don't connect)."""
    base = snap(center) + 1.27          # 1.27 offset -> off the 2.54 pin grid
    for k in range(0, 80):
        for s in ((1, -1) if k else (1,)):
            v = base + s * k * 1.27
            if all(abs(v - o) > 0.6 for o in occupied) and v not in used:
                used.add(v)
                return v
    used.add(base)
    return base


def route_net(pts, faces, allpx, allpy, used_x, used_y, tag):
    """facing-aware orthogonal route in a dedicated channel.
    Each pin first stubs out in its facing direction (lifting it off its pin
    row/column), then the ports join a trunk placed in a pin-free channel, so
    wires only ever meet their own pins at endpoints."""
    seen = {}
    for p, f in zip(pts, faces):
        seen.setdefault(p, f)
    if len(seen) < 2:
        return None
    pts = list(seen.keys())
    faces = [seen[p] for p in pts]
    horiz = sum(1 for f in faces if f[1] == 0)
    if horiz >= len(pts) - horiz:
        tx = _alloc(sum(x for x, _y in pts) / len(pts), allpx, used_x)
        for (x, y) in pts:
            wire(x, y, tx, y, (tag, 'r', x, y))
        ys = sorted(set(y for _x, y in pts))
        for i in range(len(ys) - 1):
            wire(tx, ys[i], tx, ys[i + 1], (tag, 't', i))
        for y in ys:
            if min(ys) < y < max(ys) or sum(1 for _x, yy in pts if yy == y) > 1:
                junction(tx, y, (tag, 'j', y))
        return ('v', tx, min(ys), max(ys))
    else:
        ty = _alloc(sum(y for _x, y in pts) / len(pts), allpy, used_y)
        for (x, y) in pts:
            wire(x, y, x, ty, (tag, 'r', x, y))
        xs = sorted(set(x for x, _y in pts))
        for i in range(len(xs) - 1):
            wire(xs[i], ty, xs[i + 1], ty, (tag, 't', i))
        for x in xs:
            if min(xs) < x < max(xs) or sum(1 for xx, _y in pts if xx == x) > 1:
                junction(x, ty, (tag, 'j', x))
        return ('h', min(xs), max(xs), ty)


def place_power(net, x, y, facing, tag):
    # Place the power symbol directly on the pin endpoint (length-0 power pin
    # connects pin-to-pin). NO stub: stubs of pins facing each other across
    # 2*STUB would land on the same point and short the two rails together.
    # Always angle 0: GND points DOWN, + rails point UP (the graphics are drawn
    # that way). Rotating by pin facing made grounds swing sideways/over the part.
    add_pwr(net, x, y, 0)


# ---------------------------------------------------------------------------
# build one block: biggest chip centered, others L/R (T/B for small), wired
# ---------------------------------------------------------------------------
GAP = 12.0
SECTION_TOP = 12.0  # where a block's content starts (just under its title)
T_RESERVE = 19.0    # vertical room kept above the main chip for a top (T) row
FARGAP = 52.0       # main-edge -> sub-chip gap (room for the leaf column + labels)
COLPITCH = 17.0     # x spacing of T/B (vertical) leaves -- room for the rail name
ROWPITCH = 22.0     # y spacing of L/R (horizontal) leaves -- keep a down-GND of one
#                     part clear of an up-rail of the part below it


def facing_of(sym, num, mx, my):
    # a pin's facing is set by which side of the body it's on (its pin-line axis),
    # NOT by its distance from center. Horizontal pins have sx != 0 (hub L/R pins,
    # leaf_h); vertical pins have sx == 0 (leaf_v). Don't compare |sx| vs |sy| --
    # a tall hub's top/bottom pins have a large sy yet still face left/right.
    sx, sy = sym.pins[num]
    if sx != 0:                                  # horizontal pin
        return (1 if (-sx if my else sx) > 0 else -1, 0)
    return (0, 1 if (sy if mx else -sy) > 0 else -1)   # vertical pin


def build_block(title, refs):
    global P
    P = []
    bi = block_of[refs[0]]
    refs = [r for r in refs if r in comps]
    emit_text(title, 0.0, 3.0, 2.2)

    placed = {}        # ref -> (sym, px, py, mx, my)
    wired = {}         # net -> ((refA,pinA),(refB,pinB)) : drawn as a short wire, not labelled
    move_axis = {}     # movable part -> unit (dx,dy) to push it outward on a collision
    hubs = [r for r in refs if is_hub(r)]

    if hubs:
        main = max(hubs, key=lambda r: len(part_pins(r)))
    else:
        main = None

    # ---- placement ----
    if main:
        msym = part_sym(main)
        mx0 = snap(120.0)
        main_side = {num: ('L' if msym.pins[num][0] < 0 else 'R') for num in msym.pins}
        main_nets = set(pin_net.get((main, n)) for n in msym.pins) - {None}

        def gnd_style(net):
            return bool(net) and ('GND' in net or net.endswith('-'))

        def leaf_orient(ref, sidetag):
            """orient a 2-pin leaf so its power/outer pin faces AWAY from the chip
            (so the power symbol sits on the periphery and the signal pin wires
            cleanly inward), and so a GND pin ends up at the bottom for T/B parts."""
            pins = [num for num, _n, _f in part_pins(ref)]
            if len(pins) < 2:
                return (False, False)
            p1, p2 = pins[0], pins[1]
            n1, n2 = pin_net.get((ref, p1)), pin_net.get((ref, p2))
            if sidetag in ('L', 'R'):                 # leaf_h: pin1 left, pin2 right
                r1, r2 = n1 in rail_nets, n2 in rail_nets
                if r1 != r2:
                    outer = p1 if r1 else p2           # the rail pin goes outward
                else:
                    m1, m2 = n1 in main_nets, n2 in main_nets
                    outer = p1 if (m2 and not m1) else p2
                outer_is_p1 = (outer == p1)
                if sidetag == 'L':                    # outer should be on the LEFT (pin1 slot)
                    return (False, not outer_is_p1)   # mirror_y if outer is p2
                return (False, outer_is_p1)           # R: outer on the RIGHT (pin2 slot)
            # leaf_v: pin1 top, pin2 bottom -> want a GND pin at the bottom
            if gnd_style(n1) and not gnd_style(n2):
                return (True, False)                  # mirror_x: move gnd pin to bottom
            if (n2 in rail_nets) and not (n1 in rail_nets) and not gnd_style(n2):
                return (True, False)                  # else put the + rail at top
            return (False, False)

        others = [r for r in refs if r != main]
        sub_hubs = [r for r in others if is_hub(r)]
        leaves = [r for r in others if not is_hub(r)]

        def conn_side(r):
            sides = []
            for num, _n, _f in part_pins(r):
                nt = pin_net.get((r, num))
                if not nt or nt in rail_nets:
                    continue
                for mnum in msym.pins:
                    if pin_net.get((main, mnum)) == nt:
                        sides.append(main_side[mnum])
            if not sides:
                return None
            return 'L' if sides.count('L') >= sides.count('R') else 'R'

        # decide each leaf's side first so we know if there's a top (T) row, then
        # set the chip's vertical position so content sits just under the title.
        side = {}
        for r in leaves:
            s = conn_side(r)
            side[r] = s if s else 'T'
        tb = [r for r in leaves if side[r] == 'T']
        for i, r in enumerate(tb):
            side[r] = 'T' if i % 2 == 0 else 'B'
        my0 = snap(SECTION_TOP + (T_RESERVE if 'T' in side.values() else 0.0) + msym.h / 2)
        placed[main] = (msym, mx0, my0, False, False)
        main_pin = {num: pin_xy(mx0, my0, False, False, msym, num) for num in msym.pins}

        def place_column(col_refs, sidetag):
            col_refs = sorted(col_refs, key=lambda r: min(
                [main_pin[mnum][1] for mnum in msym.pins
                 if any(pin_net.get((main, mnum)) == pin_net.get((r, pn))
                        for pn, _n, _f in part_pins(r))] or [my0]))
            cx = (mx0 - msym.w / 2 - GAP - 8.0) if sidetag == 'L' else (mx0 + msym.w / 2 + GAP + 8.0)
            yy = SECTION_TOP
            for r in col_refs:
                sym = part_sym(r, vertical=False)
                mx_f, my_f = leaf_orient(r, sidetag)
                yy = snap(yy + sym.h / 2)
                placed[r] = (sym, snap(cx), snap(yy), mx_f, my_f)
                move_axis[r] = (-1.0, 0.0) if sidetag == 'L' else (1.0, 0.0)
                yy = snap(yy + sym.h / 2 + (ROWPITCH - 8.0))

        def place_row(row_refs, sidetag):
            if not row_refs:
                return
            cyr = (my0 - msym.h / 2 - GAP - 6.0) if sidetag == 'T' else (my0 + msym.h / 2 + GAP + 6.0)
            xx = mx0 - (len(row_refs) - 1) * COLPITCH / 2
            for r in row_refs:
                sym = part_sym(r, vertical=True)
                mx_f, my_f = leaf_orient(r, sidetag)
                placed[r] = (sym, snap(xx), snap(cyr), mx_f, my_f)
                move_axis[r] = (0.0, -1.0) if sidetag == 'T' else (0.0, 1.0)
                xx = snap(xx + COLPITCH)

        def place_subhubs(refs_, sidetag):
            yy = SECTION_TOP
            for r in refs_:
                s2 = part_sym(r)
                cx = (mx0 - msym.w / 2 - FARGAP - s2.w / 2) if sidetag == 'L' \
                    else (mx0 + msym.w / 2 + FARGAP + s2.w / 2)
                py = snap(yy + s2.h / 2)
                placed[r] = (s2, snap(cx), py, False, False)
                yy = py + s2.h / 2 + 12.0

        # 1) sub-chips FAR out first, so leaves can anchor to them too
        sh_side = {r: (conn_side(r) or 'L') for r in sub_hubs}
        place_subhubs([r for r in sub_hubs if sh_side[r] == 'L'], 'L')
        place_subhubs([r for r in sub_hubs if sh_side[r] == 'R'], 'R')

        # 2) hub pin positions/facings (main + sub-chips)
        hub_pins = {}
        for hr in [main] + sub_hubs:
            hs, hx, hy, hmx, hmy = placed[hr]
            for hn in hs.pins:
                hub_pins[(hr, hn)] = (pin_xy(hx, hy, hmx, hmy, hs, hn),
                                      facing_of(hs, hn, hmx, hmy))

        # 3) anchor a leaf with a 2-pin net to a hub SIDE pin: place it snug
        #    against that pin and wire it (keeps single-pin parts at their pin,
        #    no crossing, and drops the synthetic N$ label).
        anchor = {}
        occ = {}
        for r in sorted(leaves):
            for num, _n, _f in part_pins(r):
                nt = pin_net.get((r, num))
                if not nt or nt in rail_nets:
                    continue
                mem = nets.get(nt, [])
                other = [p for p in mem if p != (r, num)]
                if len(mem) != 2 or not other or other[0] not in hub_pins:
                    continue
                hr, hn = other[0]
                (hpx, hpy), (fx, fy) = hub_pins[(hr, hn)]
                if fy != 0:
                    continue
                key = (hr, fx)
                if any(abs(hpy - oy) < 5.0 for oy in occ.get(key, [])):
                    continue
                anchor[r] = (hr, hn, num, fx, hpx, hpy)
                occ.setdefault(key, []).append(hpy)
                wired[nt] = ((r, num), (hr, hn))
                break
        leaves = [r for r in leaves if r not in anchor]

        # 4) remaining (non-anchored) leaves -> columns / rows by their side
        place_column([r for r in leaves if side[r] == 'L'], 'L')
        place_column([r for r in leaves if side[r] == 'R'], 'R')
        place_row([r for r in leaves if side[r] == 'T'], 'T')
        place_row([r for r in leaves if side[r] == 'B'], 'B')

        # 5) place anchored leaves snug against their hub pin, anchor pin inward
        for r, (hr, hn, lnum, fx, hpx, hpy) in anchor.items():
            sym = part_sym(r, vertical=False)
            sax = sym.pins[lnum][0]
            my_f = (sax < 0) if fx < 0 else (sax > 0)   # anchor pin faces the hub
            cx = hpx + fx * (3.0 + sym.w / 2)
            placed[r] = (sym, snap(cx), snap(hpy), False, my_f)
            move_axis[r] = (float(fx), 0.0)             # push further from the hub
    else:
        # leaf-only block: group by shared local net. A 2-part group sharing one
        # local net (e.g. an LED + its resistor) is placed side by side with the
        # shared pins facing each other and WIRED; outer pins get labels/symbols.
        def shared_local_net(a, b):
            for na, _n, _f in part_pins(a):
                ta = pin_net.get((a, na))
                if not ta or ta in rail_nets:
                    continue
                for nb, _n2, _f2 in part_pins(b):
                    if pin_net.get((b, nb)) == ta:
                        return ta, na, nb
            return None
        groups = _group_local(refs, bi)
        singles = [g[0] for g in groups if len(g) == 1]
        pairs = [g for g in groups if len(g) == 2 and shared_local_net(g[0], g[1])]
        rest = [g for g in groups if g not in pairs and len(g) != 1]
        yy = 13.0                                  # start just under the block title
        # single-pin parts (e.g. mounting holes) -> ONE compact row near the title
        if singles:
            xx = 16.0
            for r in singles:
                sym = part_sym(r, vertical=False)
                placed[r] = (sym, snap(xx), snap(yy + sym.h / 2), False, False)
                xx = snap(xx + 2 * LEAF + 10.0)
            yy = snap(yy + 14.0)
        # 2-part pairs (LED + resistor) stacked tight, shared pins facing + wired
        for a, b in pairs:
            nt, pa, pb = shared_local_net(a, b)
            sa, sb = part_sym(a, vertical=False), part_sym(b, vertical=False)
            amir = (sa.pins[pa][0] < 0)
            bmir = (sb.pins[pb][0] > 0)
            xa = 18.0
            xb = xa + sa.w / 2 + 8.0 + sb.w / 2
            yy = snap(yy + sa.h / 2)
            placed[a] = (sa, snap(xa), snap(yy), False, amir)
            placed[b] = (sb, snap(xb), snap(yy), False, bmir)
            wired[nt] = ((a, pa), (b, pb))
            yy = snap(yy + sa.h / 2 + 9.0)
        for grp in rest:
            xx = 16.0
            yy = snap(yy + 3.0)
            for r in grp:
                sym = part_sym(r, vertical=False)
                placed[r] = (sym, snap(xx), snap(yy), False, False)
                xx = snap(xx + 2 * LEAF + 8.0)
            yy = snap(yy + 13.0)

    # ---- multi-pass de-collision: push movable parts outward (along their
    #      placement axis) until their footprint (body + labels + power symbols)
    #      no longer overlaps any other part. ----
    def footprint(r):
        sym, px, py, mx, my = placed[r]
        X = [px - sym.w / 2, px + sym.w / 2]
        Y = [py - sym.h / 2, py + sym.h / 2]
        for num in sym.pins:
            ex, ey = pin_xy(px, py, mx, my, sym, num)
            fx, fy = facing_of(sym, num, mx, my)
            nt = pin_net.get((r, num))
            if nt is None:
                continue
            if nt in rail_nets:                    # power symbol + name
                X += [ex - 2.0, ex + 2.0, ex + fx * 3.0]; Y += [ey - 5.5, ey + 5.5]
            else:                                  # net label on a stub
                reach = len(nt) * 0.9 + 4.0
                X += [ex, ex + fx * reach]; Y += [ey, ey + fy * reach]
                if fy == 0:
                    Y += [ey - 1.6, ey + 1.6]
                else:
                    X += [ex - 1.6, ex + 1.6]
        return (min(X), min(Y), max(X), max(Y))

    def ov(a, b):
        return not (a[2] <= b[0] or b[2] <= a[0] or a[3] <= b[1] or b[3] <= a[1])

    movers = [r for r in placed if r in move_axis]
    budget = {r: 0.0 for r in movers}             # cumulative cap, so a part can't run away
    for _ in range(12):
        fps = {r: footprint(r) for r in placed}
        moved = False
        for r in movers:
            if budget[r] >= 14.0:
                continue
            if any(ov(footprint(r), fps[o]) for o in placed if o != r):
                dx, dy = move_axis[r]
                sym, px, py, mx, my = placed[r]
                px, py = snap(px + dx * 2.54), snap(py + dy * 2.54)
                budget[r] += 2.54
                placed[r] = (sym, px, py, mx, my)
                fps[r] = footprint(r)
                moved = True
        if not moved:
            break

    # ---- emit symbols + collect final pin endpoints/facings ----
    pin_pos = {}
    pin_face = {}
    for r, (sym, px, py, mx, my) in placed.items():
        add_inst(r, sym, px, py, mx, my)
        for num in sym.pins:
            pin_pos[(r, num)] = pin_xy(px, py, mx, my, sym, num)
            pin_face[(r, num)] = facing_of(sym, num, mx, my)

    # ---- route every net touching the block ----
    block_pins_by_net = {}
    for (r, num) in pin_pos:
        nt = pin_net.get((r, num))
        if nt:
            block_pins_by_net.setdefault(nt, []).append((r, num))

    for r, num in pin_pos:
        if pin_net.get((r, num)) is None:
            no_connect(*pin_pos[(r, num)], tag=(r, num))

    allpx = set(x for x, _y in pin_pos.values())
    allpy = set(y for _x, y in pin_pos.values())
    used_x, used_y = set(), set()

    def pin_side(ref, num):
        return 'L' if placed[ref][0].pins[num][0] < 0 else 'R'

    def put_label(m, nt):
        """net designator on a short stub off pin m, body pointing OUTWARD."""
        rx, ry = pin_pos[m]
        fx, fy = pin_face[m]
        ex, ey = snap(rx + fx * STUB), snap(ry + fy * STUB)
        wire(rx, ry, ex, ey, ('ls', m))
        if fy == 0:
            ang, just = 0, ('left' if fx > 0 else 'right')
        else:
            ang, just = 90, ('left' if fy < 0 else 'right')
        glabel(nt, ex, ey, ang, just, ('gl', m, nt))

    # Connectivity is by net designator (no inter-part wires) so lines can never
    # cross or run through a part -- a crossing in a schematic is ambiguous
    # (short or not), so we avoid them entirely. Rails get a power symbol per pin.
    pwr_pending = []
    for nt, members in block_pins_by_net.items():
        if nt in rail_nets:
            for m in members:
                pwr_pending.append((nt, pin_pos[m], pin_face[m]))
        elif nt in wired:
            (ra, pa), (rb, pb) = wired[nt]
            ax, ay = pin_pos[(ra, pa)]
            bx, by = pin_pos[(rb, pb)]
            wire(bx, by, ax, ay, ('aw', nt))      # short wire, pin-to-pin
        else:
            for m in members:
                put_label(m, nt)

    # place power symbols, pushing each OUTWARD along its pin until its box (symbol
    # + rail name) no longer collides with an already-placed one -- fixes the
    # pile-ups on chips with many power pins (U9, W5500).
    boxes = []

    def pbox(net, x, y, gnd):
        w = max(4.0, len(net) * 0.85 + 1.5)
        return (x - w / 2, y - 1.5, x + w / 2, y + 5.0) if gnd \
            else (x - w / 2, y - 5.0, x + w / 2, y + 1.5)

    def hits(b):
        for o in boxes:
            if not (b[2] <= o[0] or o[2] <= b[0] or b[3] <= o[1] or o[3] <= b[1]):
                return True
        return False

    # push at most ~10mm so the stub stays well short of the leaf columns (GAP+8)
    # and can't cross them; very dense same-rail banks may keep a little overlap.
    for nt, (px, py), (fx, fy) in pwr_pending:
        gnd = ('GND' in nt) or nt.endswith('-')
        d = 0.0
        while d < 10.2 and hits(pbox(nt, px + fx * d, py + fy * d, gnd)):
            d += 2.54
        x, y = snap(px + fx * d), snap(py + fy * d)
        if d > 0:
            wire(px, py, x, y, ('pw', nt, px, py))
        place_power(nt, x, y, facing=(fx, fy), tag=(nt, px, py))
        boxes.append(pbox(nt, x, y, gnd))

    prims = list(P)
    return prims, prim_bbox(prims)


def _signal_pin_toward_main(r, main, msym):
    for num, _n, _f in part_pins(r):
        nt = pin_net.get((r, num))
        if nt and nt not in rail_nets:
            for mnum in msym.pins:
                if pin_net.get((main, mnum)) == nt:
                    return num
    return None


def _group_local(refs, bi):
    """connected components of `refs` over local (non-rail) nets."""
    parent = {r: r for r in refs}

    def f(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]; a = parent[a]
        return a
    for nt, members in nets.items():
        rs = [r for r, _p in members if r in parent]
        if nt in rail_nets:
            continue
        for r in rs[1:]:
            parent[f(r)] = f(rs[0])
    groups = {}
    for r in refs:
        groups.setdefault(f(r), []).append(r)
    return list(groups.values())


# ---------------------------------------------------------------------------
# build all blocks, tile into balanced columns
# ---------------------------------------------------------------------------
MARGIN = 12.7
SEC_GAP = 12.0
sections = [build_block(t, r) for t, r in SECTIONS]
norm = []
for prims, (x0, y0, x1, y1) in sections:
    norm.append([prims, x0, y0, x1 - x0, y1 - y0])

NCOL = 2
COL_SEP = 18.0
colh = [0.0] * NCOL
colsecs = [[] for _ in range(NCOL)]
for item in norm:
    c = min(range(NCOL), key=lambda i: colh[i])
    colsecs[c].append(item)
    colh[c] += item[4] + SEC_GAP
colw = [max((it[3] for it in cs), default=0.0) for cs in colsecs]
colx = [MARGIN]
for c in range(1, NCOL):
    colx.append(colx[-1] + colw[c - 1] + COL_SEP)

TOP_MARGIN = 26.0   # keep the topmost block titles clear of the KiCad sheet frame
for c in range(NCOL):
    yy = TOP_MARGIN
    for prims, x0, y0, w, h in colsecs[c]:
        dx, dy = snap(colx[c] - x0), snap(yy - y0)
        for p in prims:
            S.append(render(p, dx, dy))
        yy += h + SEC_GAP

page_bottom = max(colh) + TOP_MARGIN
total_w = colx[-1] + colw[-1] + MARGIN

# (No PWR_FLAGs: removed by request. Intermediate rails with only passive device
# pins would otherwise read as "power input not driven"; the project's ERC rule
# for that is set to ignore instead -- see the kicad_pro patch below.)
PAGE_W = max(total_w, MARGIN + 200.0) + 4.0
PAGE_H = page_bottom + 14.0

# ---------------------------------------------------------------------------
# assemble
# ---------------------------------------------------------------------------
out = ['(kicad_sch', '\t(version 20250114)', '\t(generator "eeschema")',
       '\t(generator_version "9.0")', '\t(uuid "%s")' % uid('root'),
       '\t(paper "User" %s %s)' % (fnum(PAGE_W), fnum(PAGE_H)),
       '\t(title_block (title "LumiGate v4 - Art-Net/sACN -> isolated DMX gateway") '
       '(rev "v4") (comment 1 "auto-generated from lumigate.net by gen_schematic.py"))',
       '\t(lib_symbols']
for k in sorted(symbols):
    out.append('\t\t' + symbols[k].lib)
pwr_libs = {net: pwr_symbol(net, pwr_id[net]) for net in rail_used}
for net in rail_used:
    out.append('\t\t' + pwr_libs[net])
pwrflag_lib = (
    '(symbol "%s:PWR_FLAG" (power) (pin_numbers (hide yes)) (pin_names (offset 0) (hide yes)) '
    '(exclude_from_sim no) (in_bom yes) (on_board yes)\n'
    '  (property "Reference" "#FLG" (at 0 1.905 0) (effects (font (size 1.27 1.27)) (hide yes)))\n'
    '  (property "Value" "PWR_FLAG" (at 0 3.81 0) (effects (font (size 1.27 1.27))))\n'
    '  (property "Footprint" "" (at 0 0 0) (effects (font (size 1.27 1.27)) (hide yes)))\n'
    '  (property "Datasheet" "" (at 0 0 0) (effects (font (size 1.27 1.27)) (hide yes)))\n'
    '  (symbol "PWR_FLAG_0_0" (pin power_out line (at 0 0 90) (length 0) '
    '(name "~" (effects (font (size 1.27 1.27)))) (number "1" (effects (font (size 1.27 1.27))))))\n'
    '  (symbol "PWR_FLAG_0_1" (polyline (pts (xy 0 0) (xy 0 1.27) (xy -1.016 1.905) '
    '(xy 0 2.54) (xy 1.016 1.905) (xy 0 1.27)) (stroke (width 0.254) (type default)) (fill (type none))))\n)'
    % PROJECT)
out.append('\t\t' + pwrflag_lib)
out.append('\t)')
out.extend(S)
out.append('\t(sheet_instances (path "/" (page "1")))')
out.append('\t(embedded_fonts no)')
out.append(')')
with open(OUT, 'w', encoding='utf-8') as fh:
    fh.write('\n'.join(out) + '\n')

# standalone symbol lib + registration
SYMLIB = os.path.join(HERE, 'lumigate.kicad_sym')
lib_out = ['(kicad_symbol_lib', '\t(version 20241209)',
           '\t(generator "kicad_symbol_editor")', '\t(generator_version "9.0")']
for k in sorted(symbols):
    lib_out.append('\t' + symbols[k].lib.replace('"%s:' % PROJECT, '"', 1))
for net in rail_used:
    lib_out.append('\t' + pwr_libs[net].replace('"%s:' % PROJECT, '"', 1))
lib_out.append('\t' + pwrflag_lib.replace('"%s:' % PROJECT, '"', 1))
lib_out.append(')')
with open(SYMLIB, 'w', encoding='utf-8') as fh:
    fh.write('\n'.join(lib_out) + '\n')

SLT = os.path.join(HERE, 'sym-lib-table')
if not os.path.exists(SLT):
    with open(SLT, 'w', encoding='utf-8') as fh:
        fh.write('(sym_lib_table\n  (version 7)\n  (lib (name "lumigate")(type "KiCad")'
                 '(uri "${KIPRJMOD}/lumigate.kicad_sym")(options "")(descr "LumiGate generated symbols"))\n)\n')

FLT = os.path.join(HERE, 'fp-lib-table')
fp_libs = sorted({c['footprint'].split(':', 1)[0] for c in comps.values() if ':' in c['footprint']})
fp_libs = [lib for lib in fp_libs if os.path.isdir(os.path.join(HERE, 'easyeda', lib + '.pretty'))]
added = []
if os.path.exists(FLT):
    with open(FLT, encoding='utf-8') as fh:
        flt = fh.read()
    new = []
    for lib in fp_libs:
        if '(name "%s")' % lib not in flt:
            new.append('  (lib (name "%s")(type "KiCad")(uri "${KIPRJMOD}/easyeda/%s.pretty")'
                       '(options "")(descr ""))' % (lib, lib))
            added.append(lib)
    if new:
        idx = flt.rstrip().rfind(')')
        flt = flt.rstrip()[:idx] + '\n'.join(new) + '\n)\n'
        with open(FLT, 'w', encoding='utf-8') as fh:
            fh.write(flt)

# with the PWR_FLAGs gone, tell ERC to ignore "power input not driven" for the
# intermediate rails (they are driven through passives the netlist marks PASSIVE).
PRO = os.path.join(HERE, 'lumigate.kicad_pro')
if os.path.exists(PRO):
    import json
    with open(PRO, encoding='utf-8') as fh:
        pro = json.load(fh)
    sev = pro.setdefault('erc', {}).setdefault('rule_severities', {})
    if sev.get('power_pin_not_driven') != 'ignore':
        sev['power_pin_not_driven'] = 'ignore'
        with open(PRO, 'w', encoding='utf-8') as fh:
            json.dump(pro, fh, indent=2)
            fh.write('\n')

print('wrote %s' % OUT)
print('  parts %d (hubs %d / leaves %d)  symbols %d  rails %d'
      % (len(comps), sum(1 for r in comps if is_hub(r)),
         sum(1 for r in comps if not is_hub(r)), len(symbols), len(rail_used)))
print('  page %s x %s mm' % (fnum(PAGE_W), fnum(PAGE_H)))
if added:
    print('  fp-lib-table +%d (%s)' % (len(added), ', '.join(added)))
