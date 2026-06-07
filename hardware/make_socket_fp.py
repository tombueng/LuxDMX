#!/usr/bin/env python
"""Generate the Olimex_ESP32-POE-ISO_socket KiCad footprint (.kicad_mod).

Two 1x10 female headers, 2.54mm pitch, 25.4mm (1") apart, pin 1 of both rows
aligned — geometry taken from the Olimex ESP32-POE-ISO Rev.I .kicad_pcb
(EXT1 @ x=91.44, EXT2 @ x=116.84, same y; ΔX = 25.40mm).

Pad numbering: 1-10 = EXT1, 11-20 = EXT2 (matches lumigate_carrier.py / netlist).
"""
import os, uuid

PITCH = 2.54
ROWGAP = 25.40
N = 10
DRILL = 1.0
PAD = 1.7
HERE = os.path.dirname(os.path.abspath(__file__))
OUTDIR = os.path.join(HERE, 'LumiGate.pretty')
os.makedirs(OUTDIR, exist_ok=True)

# signal label per pad number (1..20)
SIG = {
    1: '+5V', 2: '+3V3', 3: 'GND', 4: 'EN', 5: 'IO0', 6: 'IO1', 7: 'IO2',
    8: 'IO3', 9: 'IO4', 10: 'IO5',
    11: 'IO39', 12: 'IO36', 13: 'IO35', 14: 'IO34', 15: 'IO33', 16: 'IO32',
    17: 'IO16', 18: 'IO15', 19: 'IO14', 20: 'IO13',
}

# geometry: centre the footprint on (0,0)
y0 = -(N - 1) * PITCH / 2.0          # pad1 y
x_ext1 = -ROWGAP / 2.0
x_ext2 = +ROWGAP / 2.0


def U():
    return str(uuid.uuid4())


def pad(num, x, y):
    shape = 'rect' if num in (1, 11) else 'circle'   # mark pin1 of each row
    return (f'  (pad "{num}" thru_hole {shape} (at {x:.2f} {y:.3f}) '
            f'(size {PAD} {PAD}) (drill {DRILL}) (layers "*.Cu" "*.Mask") (uuid "{U()}"))')


def fab_label(x, y, txt, just_left):
    j = 'left' if just_left else 'right'
    xo = x + (1.4 if just_left else -1.4)
    return (f'  (fp_text user "{txt}" (at {xo:.2f} {y:.3f}) (layer "F.Fab") '
            f'(uuid "{U()}") (effects (font (size 0.6 0.6) (thickness 0.1)) (justify {j})))')


def line(x1, y1, x2, y2, layer, w=0.12):
    return (f'  (fp_line (start {x1:.2f} {y1:.2f}) (end {x2:.2f} {y2:.2f}) '
            f'(stroke (width {w}) (type solid)) (layer "{layer}") (uuid "{U()}"))')


def rect(x1, y1, x2, y2, layer, w=0.12):
    return '\n'.join([line(x1, y1, x2, y1, layer, w), line(x2, y1, x2, y2, layer, w),
                      line(x2, y2, x1, y2, layer, w), line(x1, y2, x1, y1, layer, w)])


parts = []
parts.append('(footprint "Olimex_ESP32-POE-ISO_socket"')
parts.append('  (version 20240108)')
parts.append('  (generator "lumigate")')
parts.append('  (generator_version "9.0")')
parts.append('  (layer "F.Cu")')
parts.append('  (descr "Socket for Olimex ESP32-POE-ISO module. Two 1x10 female headers, '
             '2.54mm pitch, 25.4mm apart. Pads 1-10=EXT1, 11-20=EXT2. Geometry from Rev.I PCB.")')
parts.append('  (tags "olimex esp32 poe iso socket dual 1x10")')
parts.append('  (attr through_hole)')
parts.append(f'  (fp_text reference "REF**" (at 0 {y0-2.2:.2f}) (layer "F.SilkS") (uuid "{U()}") '
             '(effects (font (size 1 1) (thickness 0.15))))')
parts.append(f'  (fp_text value "ESP32-POE-ISO" (at 0 {-y0+2.2:.2f}) (layer "F.Fab") (uuid "{U()}") '
             '(effects (font (size 1 1) (thickness 0.15))))')

# pads + fab labels
for i in range(N):
    y = y0 + i * PITCH
    n1 = i + 1            # EXT1: 1..10
    n2 = 11 + i           # EXT2: 11..20
    parts.append(pad(n1, x_ext1, y))
    parts.append(fab_label(x_ext1, y, SIG[n1], just_left=True))
    parts.append(pad(n2, x_ext2, y))
    parts.append(fab_label(x_ext2, y, SIG[n2], just_left=False))

# silk outlines per header row (offset 1.3mm around the pad column)
o = 1.3
parts.append(rect(x_ext1 - o, y0 - o, x_ext1 + o, y0 + (N - 1) * PITCH + o, 'F.SilkS'))
parts.append(rect(x_ext2 - o, y0 - o, x_ext2 + o, y0 + (N - 1) * PITCH + o, 'F.SilkS'))
# header name labels
parts.append(f'  (fp_text user "EXT1" (at {x_ext1:.2f} {y0 - 3.0:.2f}) (layer "F.SilkS") (uuid "{U()}") '
             '(effects (font (size 0.8 0.8) (thickness 0.12))))')
parts.append(f'  (fp_text user "EXT2" (at {x_ext2:.2f} {y0 - 3.0:.2f}) (layer "F.SilkS") (uuid "{U()}") '
             '(effects (font (size 0.8 0.8) (thickness 0.12))))')
# pin-1 markers (small triangle dot) near pad1 of each row
for xr in (x_ext1, x_ext2):
    parts.append(f'  (fp_circle (center {xr - 1.6:.2f} {y0:.2f}) (end {xr - 1.3:.2f} {y0:.2f}) '
                 f'(stroke (width 0.2) (type solid)) (fill solid) (layer "F.SilkS") (uuid "{U()}"))')

# courtyard around everything
cx = ROWGAP / 2.0 + o + 0.4
cy = (N - 1) * PITCH / 2.0 + o + 0.4
parts.append(rect(-cx, -cy, cx, cy, 'F.CrtYd', 0.05))
# fab outline (approx module body width = the pad field; real module overhangs at the
# connector end — placed by the user)
parts.append(rect(-ROWGAP / 2.0, y0, ROWGAP / 2.0, y0 + (N - 1) * PITCH, 'F.Fab', 0.1))

parts.append(')')

out = os.path.join(OUTDIR, 'Olimex_ESP32-POE-ISO_socket.kicad_mod')
open(out, 'w', encoding='utf-8').write('\n'.join(parts) + '\n')
print('WROTE', out)
