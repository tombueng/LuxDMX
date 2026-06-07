#!/usr/bin/env python
"""Generate a JLCPCB-format assembly BOM (CSV) from the netlist.

Groups identical SMD parts by value+footprint; lists through-hole parts
separately (hand-soldered, NOT part of JLCPCB SMT assembly).
Columns: Comment, Designator, Footprint, LCSC Part #  (+ Type for clarity).
"""
import os, re, csv
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
NET = os.path.join(HERE, 'lumigate_carrier.net')

# through-hole / hand-soldered footprints -> excluded from SMT assembly
THT_HINTS = ('Olimex_ESP32-POE-ISO_socket', 'Jack_XLR', 'PinHeader', 'USB_C_Receptacle')

# known LCSC part numbers (verified). Fill remaining from JLCPCB parts search:
#  74LVC1G125 -> pick a SOT-23-5 (DBV) variant to match the footprint (not SOT-353/GW)
#  PTC 1A     -> pick a 1206 resettable fuse, ~1.1A hold
#  100nF/10uF/120R/10k/330R/5k1 -> JLCPCB auto-matches basic 0805/1206 parts on upload
LCSC = {
    ('ADM2587EBRWZ', 'Package_SO:SOIC-20W_7.5x12.8mm_P1.27mm'): 'C12081',
    ('SM712', 'Package_TO_SOT_SMD:SOT-23'): 'C404012',
    ('SS34', 'Diode_SMD:D_SMA'): 'C8678',
    ('SMAJ5.0A', 'Diode_SMD:D_SMB'): 'C87074',
    ('WS2812B', 'LED_SMD:LED_WS2812B_PLCC4_5.0x5.0mm_P3.2mm'): 'C2761795',
    # passives — JLCPCB Basic Library (UNI-ROYAL 0805 / Samsung-YAGEO caps), verified 2026-06-07
    ('100nF', 'Capacitor_SMD:C_0805_2012Metric'): 'C49678',   # CC0805KRX7R9BB104
    ('10uF', 'Capacitor_SMD:C_1206_3216Metric'): 'C13585',    # CL31A106KBHNNNE
    ('120R', 'Resistor_SMD:R_0805_2012Metric'): 'C17437',     # 0805W8F1200T5E
    ('10k', 'Resistor_SMD:R_0805_2012Metric'): 'C17414',      # 0805W8F1002T5E
    ('330R', 'Resistor_SMD:R_0805_2012Metric'): 'C17630',     # 0805W8F3300T5E
    ('5k1', 'Resistor_SMD:R_0805_2012Metric'): 'C27834',      # 0805W8F5101T5E
    ('74LVC1G125', 'Package_TO_SOT_SMD:SOT-23-5'): 'C23654',  # TI SN74LVC1G125DBVR
    ('PTC 1A', 'Fuse:Fuse_1206_3216Metric'): 'C70082',        # TECHFUSE nSMD100-16V (1A hold, 1206)
}


def parse(path):
    txt = open(path, encoding='utf-8').read()
    rows = []
    for blk in re.split(r'\(comp\s+\(ref', txt)[1:]:
        ref = re.search(r'^\s*"([^"]+)"', blk)
        val = re.search(r'\(value "([^"]*)"\)', blk)
        fp = re.search(r'\(footprint "([^"]+)"\)', blk)
        if ref and val and fp:
            rows.append((ref.group(1), val.group(1), fp.group(1)))
    return rows


def is_tht(fp):
    return any(h in fp for h in THT_HINTS)


def refkey(r):
    m = re.match(r'([A-Za-z]+)(\d+)', r)
    return (m.group(1), int(m.group(2))) if m else (r, 0)


rows = parse(NET)
groups = defaultdict(list)        # (value, footprint, tht) -> [refs]
for ref, val, fp in rows:
    groups[(val, fp, is_tht(fp))].append(ref)

smt, tht = [], []
for (val, fp, t), refs in groups.items():
    refs = sorted(refs, key=refkey)
    fp_short = fp.split(':', 1)[1]
    lcsc = LCSC.get((val, fp), '')
    rec = {'Comment': val, 'Designator': ','.join(refs), 'Footprint': fp_short,
           'LCSC Part #': lcsc, 'Type': 'Hand-solder (THT)' if t else 'SMT'}
    (tht if t else smt).append(rec)

smt.sort(key=lambda r: r['Designator'])
tht.sort(key=lambda r: r['Designator'])

cols = ['Comment', 'Designator', 'Footprint', 'LCSC Part #', 'Type']
out = os.path.join(HERE, 'lumigate_carrier_BOM_jlcpcb.csv')
with open(out, 'w', newline='', encoding='utf-8') as f:
    w = csv.DictWriter(f, fieldnames=cols)
    w.writeheader()
    for r in smt:
        w.writerow(r)
    for r in tht:                 # hand-solder parts at the bottom for reference
        w.writerow(r)

print(f"SMT lines: {len(smt)} ({sum(len(g) for (v,fp,t),g in groups.items() if not t)} parts)")
print(f"Hand-solder lines: {len(tht)}")
print("missing LCSC#:", [r['Comment'] for r in smt if not r['LCSC Part #']])
print("WROTE", out)
