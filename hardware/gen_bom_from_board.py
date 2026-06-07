"""Generate JLCPCB BOM from the board, mapping each designator to its part + LCSC#.
Board footprint 'value' fields are generic, so we map by reference (authoritative)."""
import pcbnew, csv, re

PCB = r"C:\dev\DMX\hardware\lumigate_carrier.kicad_pcb"
OUT = r"C:\dev\DMX\hardware\lumigate_carrier_BOM_jlcpcb.csv"

# ref -> (comment/value, LCSC#)  — all verified JLCPCB-assemblable
INFO = {
    "C1": ("100nF", "C49678"), "C3": ("100nF", "C49678"), "C5": ("100nF", "C49678"),
    "C6": ("100nF", "C49678"), "C7": ("100nF", "C49678"),
    "C2": ("10uF", "C13585"), "C4": ("10uF", "C13585"),
    "D1": ("SM712", "C404012"), "D2": ("SMAJ5.0A", "C87074"), "D3": ("SS34", "C8678"),
    "F1": ("PTC 1A 1206", "C70082"),
    "LED1": ("WS2812B", "C2761795"),
    "R1": ("120R", "C17437"), "R2": ("10k", "C17414"), "R6": ("330R", "C17630"),
    "Rcc1": ("5k1", "C27834"), "Rcc2": ("5k1", "C27834"),
    "U2": ("ADM2587EBRWZ", "C12081"), "U3": ("74LVC1G125", "C23654"),
    "J1": ("XLR-3 female RA (XLR-328P)", "C309326"),
    "J2": ("USB-C 6P power (TYPE-C 6P)", "C456012"),
    "J3": ("1x10 socket 2.54 (C35445)", "C35445"),
    "J4": ("1x10 socket 2.54 (C35445)", "C35445"),
}

b = pcbnew.LoadBoard(PCB)
from collections import defaultdict
groups = defaultdict(list)
for fp in b.GetFootprints():
    ref = fp.GetReference()
    if ref not in INFO:
        continue  # U1 placeholder / anything else
    comment, lcsc = INFO[ref]
    fp_short = str(fp.GetFPID().GetLibItemName())
    groups[(comment, fp_short, lcsc)].append(ref)

def key(r):
    m = re.match(r"([A-Za-z]+)(\d+)", r)
    return (m.group(1), int(m.group(2))) if m else (r, 0)

rows = []
for (comment, fp_short, lcsc), refs in groups.items():
    refs.sort(key=key)
    rows.append({"Comment": comment, "Designator": ",".join(refs),
                 "Footprint": fp_short, "LCSC Part #": lcsc, "Type": "SMT/Assembly"})
rows.sort(key=lambda r: key(r["Designator"].split(",")[0]))

with open(OUT, "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=["Comment", "Designator", "Footprint", "LCSC Part #", "Type"])
    w.writeheader(); w.writerows(rows)

print(f"BOM lines: {len(rows)}, parts: {sum(len(r['Designator'].split(',')) for r in rows)}")
print("missing LCSC#:", [r["Designator"] for r in rows if not r["LCSC Part #"]] or "none")
