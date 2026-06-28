"""Generate JLCPCB BOM (Comment, Designator, Footprint, LCSC) from the v3 board.
Maps each designator -> part + LCSC#. Every part now has a firm in-stock LCSC#; rows are
grouped by LCSC# so each part appears on exactly one line (JLCPCB requirement)."""
import pcbnew, csv, re
from collections import defaultdict

PCB = r"C:\dev\DMX\hardware\luxdmx.kicad_pcb"
OUT = r"C:\dev\DMX\hardware\luxdmx_BOM_jlcpcb.csv"

# ref -> (comment, LCSC#)   ("" = choose in JLCPCB picker)
INFO = {
    "U1": ("ESP32-S3-WROOM-1-N8 (8MB)", "C2913198"),
    "U2": ("W5500 SPI Ethernet", "C32843"),
    "U3": ("CH340C USB-UART", "C84681"),
    "U4": ("SY8089 buck 5->3.3V", "C78988"),
    "U5": ("ISO3086DWR isolated RS-485", "C183095"),
    "PS1": ("B0505S-1W iso DC-DC (EVISUN)", "C7465127"),
    "J1": ("Neutrik NC5FAH XLR-5 female horizontal PCB (E1.11 DMX out)", "C368501"),
    "J2": ("USB-C data (TYPE-C-31-M-12)", "C165948"),
    "J3": ("RJ45 MagJack HY931147C PoE 10/100 (integrated rectifier + magnetics)", "C91754"),
    "J4": ("JST SH 1.0mm 9-pin SMD SM09B-SRSS-TB (optional display; pre-crimped cables)", "C160408"),
    "Y1": ("25MHz crystal 2520", "C2981622"),
    "L1": ("2.2uH power inductor (CKCS4030)", "C354584"),
    "D1": ("SM712 TVS SOT-23", "C404012"),
    "Q1": ("MMBT3904 SOT-23", "C20526"), "Q2": ("MMBT3904 SOT-23", "C20526"),
    "SW1": ("tact sw B3U-1000P", "C231329"), "SW2": ("tact sw B3U-1000P", "C231329"),
    # resistors
    "R1": ("10k 0402", "C25744"), "R2": ("10k 0402", "C25744"), "R6": ("10k 0402", "C25744"),
    "R7": ("10k 0402", "C25744"), "R11": ("10k 0402", "C25744"),
    "R3": ("12k 0402 W5500 EXRES1 (12.4k spec OOS at LCSC; 12k within 100BASE-TX +-5%)", "C25752"),
    "R10": ("45.3k 0402 1% (buck FB top -> 3.32V)", "C137977"),
    "R13": ("1k 0402", "C11702"), "R15": ("1k 0402", "C11702"),
    "R14": ("150R 0402", "C25082"), "R16": ("150R 0402", "C25082"),
    "R17": ("150R 0402", "C25082"),
    "R18": ("49.9R 1% 0402 W5500 TX center-tap bias", "C25120"),   # BASIC (UNI-ROYAL 0402WGF499, 1%) - no fee
    "R4": ("330R 0402", "C25104"), "R5": ("330R 0402", "C25104"),
    "R8": ("5k1 0402", "C25905"), "R9": ("5k1 0402", "C25905"),
    "R12": ("120R 0805 (DMX-A termination)", "C17437"),
    # caps
    "C1": ("100nF 0402", "C1525"), "C3": ("1uF 0402 (EN power-on RC)", "C52923"), "C5": ("100nF 0402", "C1525"),
    "C8": ("100nF 0402", "C1525"), "C9": ("100nF 0402", "C1525"), "C10": ("100nF 0402", "C1525"),
    "C11": ("100nF 0402", "C1525"), "C14": ("100nF 0402", "C1525"), "C15": ("100nF 0402", "C1525"),
    "C18": ("100nF 0402", "C1525"), "C19": ("100nF 0402", "C1525"),
    "C12": ("22pF 0402", "C1555"), "C13": ("22pF 0402", "C1555"),
    "C4": ("1uF 0402", "C52923"), "C6": ("4.7uF 0402", "C23733"),
    "C2": ("10uF 0805", "C15850"), "C16": ("22uF 0805", "C45783"), "C17": ("22uF 0805", "C45783"),
    "C20": ("10uF 1206", "C13585"), "C21": ("10uF 1206", "C13585"), "C22": ("100nF 0402", "C1525"),
    # LEDs 0603 — all JLCPCB Basic, in stock
    "D2": ("LED red 0603", "C2286"), "D3": ("LED green 0603 KT-0603G", "C12624"),
    "D4": ("LED yellow 0603 NCD0603Y2", "C89811"),   # PREFERRED - no fee (KT-0603Y/C2287 was extended)
    "D5": ("LED blue 0603 KT-0603B", "C2288"),       # extended: JLCPCB has NO basic/preferred 0603 blue
    "D6": ("LED white 0603", "C2290"),
    # ---- 2nd isolated DMX universe (mirror of U5/PS1/J1/D1/R12/C18-20) ----
    "U6": ("ISO3086DWR isolated RS-485 (universe 2)", "C183095"),
    "PS2": ("B0505S-1W iso DC-DC (EVISUN, universe 2)", "C7465127"),
    "J5": ("Neutrik NC5FAH XLR-5 female horizontal PCB (E1.11 DMX out, universe 2)", "C368501"),
    "D7": ("SM712 TVS SOT-23 (universe 2)", "C404012"),
    "R19": ("120R 0805 (DMX-B termination)", "C17437"),
    # fail-safe bias (RDM idle), 470R 0402 1% UNI-ROYAL 0402WGF4700TCE (JLCPCB Basic, in stock)
    "R20": ("470R 0402 (DMX-A fail-safe bias)", "C25117"), "R21": ("470R 0402 (DMX-B fail-safe bias)", "C25117"),
    "R22": ("470R 0402 (DMX2-A fail-safe bias)", "C25117"), "R23": ("470R 0402 (DMX2-B fail-safe bias)", "C25117"),
    "C23": ("100nF 0402", "C1525"), "C24": ("100nF 0402", "C1525"),
    "C25": ("10uF 1206", "C13585"), "C26": ("10uF 1206", "C13585"),
    # ---- PoE PD stage + 5V source OR-ing ----
    "U7": ("DP9900M-5V PoE PD + isolated DC-DC module (802.3af)", "C5380106"),
    "D10": ("SMAJ58A TVS SMA (rectified-PoE surge clamp)", "C110521"),
    "U9": ("TPS2116DRLR ideal-diode power mux (USB/PoE 5V OR-ing)", "C3235557"),
    "C30": ("1uF 0603 (TPS2116 VIN1 input cap)", "C15849"),
    "C31": ("1uF 0603 (TPS2116 VIN2 input cap)", "C15849"),
    "C27": ("100uF 25V SMD electrolytic (PoE output bulk)", "C970685"),
    "C28": ("10uF 0805", "C15850"),
    "C29": ("22uF 0805 (+5V rail bulk)", "C45783"),
    # ---- ruggedization: protection / EMC parts ----
    "F1": ("BSMD1206-150-16V 1.5A/16V resettable PPTC fuse (USB VBUS)", "C883133"),
    # DMX512-A Protected (Annex C): series TBU high-speed protector per data line, TBU-CA065-200-WH
    # 200mA/650V/8.6R bidirectional electronic current limiter (in stock C913221); the standard's named
    # "fault-protected" approach -- blocks a sustained fault in <1us so the SM712 only sees the transient.
    "F2": ("TBU-CA065-200-WH 200mA 650V high-speed protector (DMX Protected series)", "C913221"),
    "F3": ("TBU-CA065-200-WH 200mA 650V high-speed protector (DMX Protected series)", "C913221"),
    "F4": ("TBU-CA065-200-WH 200mA 650V high-speed protector (DMX Protected series)", "C913221"),
    "F5": ("TBU-CA065-200-WH 200mA 650V high-speed protector (DMX Protected series)", "C913221"),
    "U8": ("USBLC6-2SC6 USB ESD/TVS array (SOT-23-6)", "C7519"),
    "D11": ("SMAJ5.0A TVS SMA (+5V transient clamp)", "C151932"),
    "L2": ("ACM2012-201-2P common-mode choke (DMX-A pair)", "C383338"),
    "L3": ("ACM2012-201-2P common-mode choke (DMX-B pair)", "C383338"),
    "FB1": ("600R@100MHz ferrite bead 0805 (+5V to DMX DC-DC)", "C139168"),
    "FB2": ("600R@100MHz ferrite bead 0805 (VISO driver)", "C139168"),
    "FB3": ("600R@100MHz ferrite bead 0805 (VISO2 driver)", "C139168"),
    # ---- expansion + DMX breakout headers ----
    "J6": ("JST SH 1.0mm 9-pin SMD SM09B-SRSS-TB (expansion header)", "C160408"),
    "J7": ("JST SH 1.0mm 3-pin SMD SM03B-SRSS-TB (DMX-A breakout)", "C160403"),
    "J8": ("JST SH 1.0mm 3-pin SMD SM03B-SRSS-TB (DMX-B breakout)", "C160403"),
}

b = pcbnew.LoadBoard(PCB)

def k(r):
    m = re.match(r"([A-Za-z]+)(\d+)", r)
    return (m.group(1), int(m.group(2))) if m else (r, 0)

# Group by LCSC# — JLCPCB matches on it, so each part must be on EXACTLY one BOM line
# (otherwise it warns "multiple positions assigned to the same part", e.g. C3+C4=C52923).
# Parts without an LCSC# fall back to comment+footprint.  Comment/footprint/LCSC are taken
# from the lowest designator in the group.
groups = defaultdict(list)
not_in_bom = []
for fp in b.GetFootprints():
    ref = fp.GetReference()
    if ref not in INFO:
        if not ref.startswith("MH"):     # mounting holes are board features, not placed parts
            not_in_bom.append(ref)
        continue
    comment, lcsc = INFO[ref]
    fpn = str(fp.GetFPID().GetLibItemName())
    key = lcsc if lcsc else f"\x00{comment}\x00{fpn}"
    groups[key].append((ref, comment, fpn, lcsc))

# HARD GATE (the C17 lesson, for assembly): a placed part with NO BOM/LCSC entry would ship
# UNPOPULATED. Refuse to write a BOM that silently drops placed parts.
if not_in_bom:
    import sys
    print(f"!! ABORT: {len(not_in_bom)} placed part(s) have NO BOM/LCSC entry (would ship UNPOPULATED): "
          f"{sorted(not_in_bom, key=k)}")
    print("   Add each to INFO with an in-stock LCSC# (verify stock first), then re-run.")
    sys.exit(1)

rows = [["Comment", "Designator", "Footprint", "LCSC Part #"]]
body = []
for items in groups.values():
    items.sort(key=lambda t: k(t[0]))
    refs = [t[0] for t in items]
    comment, fpn, lcsc = items[0][1], items[0][2], items[0][3]
    body.append([comment, ",".join(refs), fpn, lcsc])
body.sort(key=lambda row: k(row[1].split(",")[0]))
rows += body

with open(OUT, "w", newline="") as f:
    csv.writer(f).writerows(rows)

import os, sys; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    import csv_to_xlsx                               # real openpyxl xlsx; emit matching .xlsx so no stale spreadsheet
    csv_to_xlsx.convert(OUT, OUT.replace(".csv", ".xlsx"))
except Exception as e:
    print("!! BOM .xlsx NOT written (upload the .csv -- JLCPCB accepts it):", e)

placed = sum(len(v) for v in groups.values())
missing = sorted([r for r, (c, l) in INFO.items() if not l], key=k)
print(f"BOM written: {len(rows)-1} lines, {placed} parts")
print(f"LCSC to pick in JLCPCB ({len(missing)}): {missing}")
if not_in_bom:
    print(f"!! WARNING: {len(not_in_bom)} placed part(s) NOT in BOM (would NOT be assembled): {sorted(not_in_bom, key=k)}")
