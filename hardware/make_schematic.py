#!/usr/bin/env python
"""Generate a flat KiCad schematic (.kicad_sch) from the netlist.

Each component becomes a labelled box; every pin gets a short wire + a global
label carrying its net name (connectivity-by-name). Electrically complete and
readable. Validate/produce a PDF with:
  kicad-cli sch export pdf lumigate_carrier_schematic.kicad_sch
"""
import os, re, uuid

HERE = os.path.dirname(os.path.abspath(__file__))
NET = os.path.join(HERE, 'lumigate_carrier.net')
OUT = os.path.join(HERE, 'lumigate_carrier_schematic.kicad_sch')

# pin names per component (from lumigate_carrier.py) for nicer labels; fallback = number
PIN_NAMES = {
    'U1': {'1': '+5V', '2': '+3V3', '3': 'GND', '4': 'EN', '5': 'IO0', '6': 'IO1', '7': 'IO2',
           '8': 'IO3', '9': 'IO4', '10': 'IO5', '11': 'IO39', '12': 'IO36', '13': 'IO35',
           '14': 'IO34', '15': 'IO33', '16': 'IO32', '17': 'IO16', '18': 'IO15', '19': 'IO14', '20': 'IO13'},
    'U2': {'1': 'GND1', '2': 'VDD', '3': 'GND1', '4': 'RxD', '5': '/RE', '6': 'DE', '7': 'TxD',
           '8': 'VDD', '9': 'GND1', '10': 'GND1', '11': 'GND2', '12': 'VISOOUT', '13': 'Y',
           '14': 'GND2', '15': 'Z', '16': 'GND2', '17': 'B', '18': 'A', '19': 'VISOIN', '20': 'GND2'},
    'U3': {'1': 'OE', '2': 'A', '3': 'GND', '4': 'Y', '5': 'VCC'},
    'J1': {'1': 'SH', '2': 'DATA-', '3': 'DATA+', '4': 'NC', '5': 'NC', 'G': 'SHELL'},
}


def parse():
    txt = open(NET, encoding='utf-8').read()
    comps = {}
    for ref, val, fp in re.findall(r'\(comp\s+\(ref "([^"]+)"\)\s*\(value "([^"]*)"\).*?\(footprint "([^"]+)"\)', txt, re.S):
        comps[ref] = {'value': val, 'fp': fp.split(':')[-1], 'pins': []}
    for blk in re.split(r'\(net\s+\(code\s+\d+\)', txt)[1:]:
        nm = re.search(r'\(name "([^"]*)"\)', blk)
        if not nm:
            continue
        for ref, pin in re.findall(r'\(node\s*\(ref "([^"]+)"\)\s*\(pin "([^"]+)"', blk):
            if ref in comps:
                comps[ref]['pins'].append((pin, nm.group(1)))
    return comps


def U():
    return str(uuid.uuid4())


def refkey(r):
    m = re.match(r'([A-Za-z]+)(\d+)', r)
    return (m.group(1), int(m.group(2))) if m else (r, 0)


# "big" nets shown as power symbols (not labels); everything else = signal label
PWR = {'GND', 'GNDISO', '+3V3', '+5V', 'VISO', 'VBUS_C', 'VBUS_FUSED'}

P = 2.54
out = ['(kicad_sch (version 20250114) (generator "lumigate") (generator_version "9.0")',
       f'  (uuid "{U()}")', '  (paper "A2")']
libs = ['  (lib_symbols']
body = []
pwr_count = [0]


def power_symbol_def(net):
    """A simple power port symbol (down-triangle for grounds, up-bar for rails)."""
    safe = net.replace('+', 'p').replace('-', 'm')
    ground = 'GND' in net
    if ground:
        graphic = ('        (polyline (pts (xy -1.27 -2.54) (xy 1.27 -2.54) (xy 0 -3.81) (xy -1.27 -2.54)) '
                   '(stroke (width 0.2) (type default)) (fill (type none)))')
    else:
        graphic = ('        (polyline (pts (xy -1.27 -2.54) (xy 1.27 -2.54)) '
                   '(stroke (width 0.2) (type default)) (fill (type none)))')
    return [f'    (symbol "pwr:{safe}" (power) (pin_names (offset 0)) (exclude_from_sim no) (in_bom no) (on_board yes)',
            f'      (property "Reference" "#PWR" (at 0 0 0) (effects (font (size 1.27 1.27)) (hide yes)))',
            f'      (property "Value" "{net}" (at 0 1.27 0) (effects (font (size 1.27 1.27))))',
            f'      (symbol "{safe}_0_1"', graphic, '      )',
            f'      (symbol "{safe}_1_1"',
            f'        (pin power_in line (at 0 0 90) (length 2.54) (name "{net}" (effects (font (size 1.0 1.0)))) (number "1" (effects (font (size 1.0 1.0)))))',
            '      )', '    )']

comps = parse()
order = sorted(comps, key=refkey)
used_pwr = set()

# grid layout
col_w, x0, y0 = 62.0, 30.0, 30.0
cols = 6
col_h = [y0] * cols
ci = 0
for ref in order:
    c = comps[ref]
    pins = sorted(c['pins'], key=lambda t: (len(t[0]), t[0]))
    n = len(pins)
    libid = f"lg:{ref}"
    h = (n - 1) * P
    # ---- lib_symbol: box with pins on the left ----
    s = [f'    (symbol "{libid}" (pin_names (offset 1.016)) (exclude_from_sim no) (in_bom yes) (on_board yes)',
         f'      (property "Reference" "{ref}" (at 0 2.54 0) (effects (font (size 1.27 1.27))))',
         f'      (property "Value" "{c["value"]}" (at 0 {-(h)-2.54:.2f} 0) (effects (font (size 1.0 1.0))))',
         f'      (symbol "{ref}_0_1"',
         f'        (rectangle (start -2.0 2.0) (end 26.0 {-h-2.0:.2f}) (stroke (width 0.15) (type default)) (fill (type background)))',
         '      )',
         f'      (symbol "{ref}_1_1"']
    for j, (pnum, net) in enumerate(pins):
        py = -j * P
        pname = PIN_NAMES.get(ref, {}).get(pnum, pnum)
        s.append(f'        (pin passive line (at -7.62 {py:.2f} 0) (length 5.08) '
                 f'(name "{pname}" (effects (font (size 1.0 1.0)))) (number "{pnum}" (effects (font (size 0.8 0.8)))))')
    s.append('      )')
    s.append('    )')
    libs += s
    # ---- placement ----
    ci = col_h.index(min(col_h)) if False else ci
    col = ci % cols
    ix = x0 + col * col_w
    iy = col_h[col]
    col_h[col] = iy + h + 16
    ci += 1
    inst_uuid = U()
    inst = [f'  (symbol (lib_id "{libid}") (at {ix:.2f} {iy:.2f} 0) (unit 1) (exclude_from_sim no) (in_bom yes) (on_board yes) (dnp no)',
            f'    (uuid "{inst_uuid}")',
            f'    (property "Reference" "{ref}" (at {ix:.2f} {iy-2.54:.2f} 0) (effects (font (size 1.27 1.27))))',
            f'    (property "Value" "{c["value"]}" (at {ix:.2f} {iy+h+2.54:.2f} 0) (effects (font (size 1.0 1.0))))']
    for j, (pnum, net) in enumerate(pins):
        inst.append(f'    (pin "{pnum}" (uuid "{U()}"))')
    inst.append(f'    (instances (project "lumigate_carrier" (path "/" (reference "{ref}") (unit 1))))')
    inst.append('  )')
    body += inst
    # ---- per pin: power symbol for rails/gnd, signal label otherwise ----
    for j, (pnum, net) in enumerate(pins):
        px = ix - 7.62           # pin connection point (left end)
        py = iy - j * P
        lx = px - 5.08
        body.append(f'  (wire (pts (xy {px:.2f} {py:.2f}) (xy {lx:.2f} {py:.2f})) (stroke (width 0.15) (type default)) (uuid "{U()}"))')
        if net in PWR:
            used_pwr.add(net)
            safe = net.replace('+', 'p').replace('-', 'm')
            pwr_count[0] += 1
            body += [f'  (symbol (lib_id "pwr:{safe}") (at {lx:.2f} {py:.2f} 270) (unit 1) (exclude_from_sim no) (in_bom no) (on_board yes) (dnp no)',
                     f'    (uuid "{U()}")',
                     f'    (property "Reference" "#PWR{pwr_count[0]:03d}" (at {lx:.2f} {py:.2f} 0) (effects (font (size 1.27 1.27)) (hide yes)))',
                     f'    (property "Value" "{net}" (at {lx-2.0:.2f} {py:.2f} 0) (effects (font (size 1.0 1.0)) (justify right)))',
                     f'    (pin "1" (uuid "{U()}"))',
                     f'    (instances (project "lumigate_carrier" (path "/" (reference "#PWR{pwr_count[0]:03d}") (unit 1))))',
                     '  )']
        else:
            body.append(f'  (global_label "{net}" (shape input) (at {lx:.2f} {py:.2f} 180) (fields_autoplaced yes) '
                        f'(effects (font (size 1.0 1.0)) (justify right)) (uuid "{U()}"))')

for net in sorted(used_pwr):
    libs += power_symbol_def(net)
libs.append('  )')
out += libs
out += body
out.append('  (sheet_instances (path "/" (page "1")))')
out.append(')')
open(OUT, 'w', encoding='utf-8').write('\n'.join(out) + '\n')
print('WROTE', OUT, 'components:', len(comps))
