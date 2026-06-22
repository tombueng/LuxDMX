"""Generate JLCPCB BOM (Comment, Designator, Footprint, LCSC) from the v3 board.
Maps each designator -> part + LCSC#. Every part now has a firm in-stock LCSC#; rows are
grouped by LCSC# so each part appears on exactly one line (JLCPCB requirement)."""
import pcbnew, csv, re
from collections import defaultdict

PCB = r"C:\dev\DMX\hardware\lumigate.kicad_pcb"
OUT = r"C:\dev\DMX\hardware\lumigate_BOM_jlcpcb.csv"

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
    "R12": ("120R 0805", "C17437"),
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
    "R19": ("120R 0805 (DMX2 termination)", "C17437"),
    "C23": ("100nF 0402", "C1525"), "C24": ("100nF 0402", "C1525"),
    "C25": ("10uF 1206", "C13585"), "C26": ("10uF 1206", "C13585"),
    # ---- PoE PD stage + 5V source OR-ing ----
    "U7": ("DP9900M-5V PoE PD + isolated DC-DC module (802.3af)", "C5380106"),
    "D10": ("SMAJ58A TVS SMA (rectified-PoE surge clamp)", "C110521"),
    "D8": ("SS34 SMA schottky (USB 5V OR-ing)", "C8678"),
    "D9": ("SS34 SMA schottky (PoE 5V OR-ing)", "C8678"),
    "C27": ("100uF 25V SMD electrolytic (PoE output bulk)", "C970685"),
    "C28": ("10uF 0805", "C15850"),
    "C29": ("22uF 0805 (+5V rail bulk)", "C45783"),
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
for fp in b.GetFootprints():
    ref = fp.GetReference()
    if ref not in INFO:
        continue
    comment, lcsc = INFO[ref]
    fpn = str(fp.GetFPID().GetLibItemName())
    key = lcsc if lcsc else f"\x00{comment}\x00{fpn}"
    groups[key].append((ref, comment, fpn, lcsc))

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

placed = sum(len(v) for v in groups.values())
missing = sorted([r for r, (c, l) in INFO.items() if not l], key=k)
print(f"BOM written: {len(rows)-1} lines, {placed} parts")
print(f"LCSC to pick in JLCPCB ({len(missing)}): {missing}")
