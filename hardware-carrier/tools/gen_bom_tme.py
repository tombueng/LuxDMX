#!/usr/bin/env python3
"""Turn the BOM into a shopping list for TME, because LCSC is not everyone's distributor.

TME blocks automated access - both a plain fetch and curl come back 403 - so this cannot look
up symbols, stock or prices, and it does not pretend to. What it does is the part that is
actually hard: say what each line HAS to be, so any equivalent in TME's catalogue will do, and
name the handful of symbols that were confirmed by hand.

Passives are the easy half: a 1206 X7R 100nF is a 1206 X7R 100nF whoever makes it, and TME has
dozens. The interesting lines are the ones where the wrong choice looks right in a search
result, and those carry a warning here.

Quantities come from production/BOM.csv so they cannot drift from the board.

Run:  python tools/gen_bom_tme.py
"""
import csv
import os

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(HERE, "production", "BOM.csv")
OUT = os.path.join(HERE, "production", "BOM-TME.md")

# Distributor-specific knowledge, deliberately not in sourcing.json: that file describes the
# PART, this describes how to find it at one shop. Symbols marked (confirmed) were looked up
# by hand; everything else is a search term plus the spec that decides it.
TME = {
 "CL31B104KBCNNNC": ("100nF 1206 X7R, 50 V", "search: 100nF 1206 X7R 50V",
                     "Any maker. X7R matters, X5R or Y5V do not belong on a decoupling line."),
 "CL31B105KBHNNNE": ("1uF 1206 X7R, 50 V", "search: 1uF 1206 X7R 50V",
                     "X7R again. A 1uF Y5V loses most of its value at voltage."),
 "CL31A226MQHNNNE": ("22uF 1206 X5R, 6.3 V or more", "search: 22uF 1206 X5R",
                     "6.3 V is the minimum; 10 V or 16 V is fine and often cheaper. Sits on "
                     "a 3.3 V rail."),
 "EEU-FR1V102": ("1000uF 35 V radial, 13 mm can at most, 5 mm lead pitch",
                     "search: 1000uF 35V 105C radial",
                     "The can must not exceed 13 mm diameter and the leads must be 5 mm "
                     "apart - the land is drawn for exactly that."),
 "SN74AHCT541DWR": ("74AHCT541 or 74HCT541 in SO-20 300 mil",
                    "TME lists 74HCT541D,653 (confirmed), which fits the same land",
                     "WARNING, two ways to get this wrong. The suffix PW is TSSOP at 0.65 mm "
                     "and does NOT fit this board; only D (SO-20 300 mil) or TI's DW does. "
                     "And TME appeared to hold it on reel only, in poor supply - worth "
                     "checking before you count on it. AHCT is the better part if you find "
                     "it in the same package."),
 "MF-R500": ("Bourns MF-R500 polyfuse, 5 A hold, 30 V", "TME symbol MFR500-BOU (confirmed)",
                     "30 V matters: the MF-RHT and MF-RG families are 16 V parts and a 24 V "
                     "pixel supply is outside them."),
 "1206W4F1002T5E": ("10k 1206, 1 %", "search: 10k 1206 1%", "Any maker."),
 "1206W4F1200T5E": ("120R 1206, 1 %", "search: 120R 1206 1%", "Any maker."),
 "1206W4J0331T5E": ("330R 1206, 5 % or better", "search: 330R 1206",
                     "Any maker. Eleven of them: six RS-485 bias, five pixel damping."),
 "KF128-5.08-2P-AA": ("Screw terminal, 2 pole, 5.08 mm pitch", "search: PCB screw terminal 5.08 2 way",
                     "The holes are 1.40 mm, Kefa's own recommendation for these 0.9 x 0.8 mm "
                     "pins. Degson, Ninigi, PTR 5.08 mm parts fit the same way."),
 "KF128-5.08-3P-AA": ("Screw terminal, 3 pole, 5.08 mm pitch", "search: PCB screw terminal 5.08 3 way",
                     "Same. Or leave them off and solder the wire flat on the pad, which is "
                     "what the big pads are for."),
 "XY308-2.54-3P": ("Screw terminal, 3 pole, 2.54 mm pitch, x3 (DMX ports)",
                     "search: PCB screw terminal 2.54 3 way",
                     "1.20 mm holes, so most 2.54 mm terminals fit; Phoenix MPT 0,5/3-2,54 also "
                     "fits, its pegs have holes on the board. Or a plain 3-pin header."),
 "HC-PM254-8.5H-1x4PZ-02A": ("Female header 1 x 4, 2.54 mm, 8.5 mm tall (display socket)",
                     "search: female header 1x4 2.54 8.5mm",
                     "The 8.5 mm height is what lifts the OLED clear of the modules under it; "
                     "a standard 7-8.5 mm socket works, a low-profile one does not."),
 "K2-1102DP-C4SW-04": ("Tact switch 6 x 6 mm THT, x2", "search: tact switch 6x6 THT",
                     "Any plunger height 5 to 30 mm fits the land. For a front panel at the "
                     "encoder's 20 mm shaft you want about 30 mm, see below."),
 "EC11E15244B2": ("Alps EC11 rotary encoder with switch", "TME stocks the Alps EC11 family",
                     "The part inside a KY-040. 2.5 mm pin pitch, two mounting posts."),
 "SMF12CA": ("SMF12CA, bidirectional TVS, 12 V standoff", "TME symbols SMF12CA-DC / -LF / -DIO (confirmed)",
                     "Three makers list it. SMAJ12CA in SMA is the same diode at 400 W and "
                     "also lands on the pad, worth it for long outdoor runs."),
}
MODULES = [
 ("ESP32-S3-DevKitC-1 N16R8 CLONE with 25.40 mm rows", "marketplace (Binghe and similar dual USB-C clones)",
  "NOT Espressif's own DevKitC-1 that TME stocks: its rows are 22.86 mm apart and it does not "
  "fit. 8 MB PSRAM (R8) is not optional either."),
 ("W5500 Ethernet module (USR-ES1 style)", "unlikely at TME, marketplace",
  "USR-ES1 style W5500 board with a 2 x 6 pin header, same pin order as in the README."),
 ("MAX3485 module, 3.3 V, with enable, x3", "unlikely at TME, marketplace",
  "3.3 V part. A MAX485 module is a 5 V part and will not do."),
 ("1.3\" OLED SH1106, I2C, 4 pin", "unlikely at TME, marketplace",
  "Check the pin order against its own silk, the boards ship both ways round."),
 ("5 V regulator module: Pololu D24V10F5", "Pololu or its distributors, not TME",
  "Only if the logic runs off the 12/24 V supply. Fixed 5 V, nothing to set. D36V28F5, a "
  "RECOM R-78E5.0-1.0 / Mornsun K7805-1000R3 SIP or an MP1584EN board (set to 5.0 V first) "
  "fit the same spot, see the README's Regulator section."),
 ("Fuse holder, MINI blade (ATM), Keystone 3568", "TME symbol KEYS3568 (confirmed)",
  "Only if you fit a blade fuse instead of the polyfuse, never both. MINI/ATM size - the "
  "regular ATO/ATC fuse is almost twice as wide and does not go in. The holder is good for "
  "30 A, the board is not: 9.8 A is where the copper gives out, so size the fuse for the load."),
 ("Tact switch 6 x 6 mm THT, long plunger, x2", "CHECK: TME may not go past ~13-17 mm",
  "The board wants roughly 30 mm to clear the same panel as the encoder shaft. Western "
  "distributors tend to stop well short of that - this one may have to come from a "
  "marketplace, or you use a shorter switch and a cap."),
]


def main():
    rows = list(csv.DictReader(open(SRC)))
    seen, lines = set(), []
    for r in rows:
        mpn = (r.get("MPN") or "").strip()
        if not mpn or mpn in seen or mpn not in TME:
            continue
        seen.add(mpn)
        what, where, note = TME[mpn]
        lines.append((r["Qty"], what, where, note))

    with open(OUT, "w", encoding="utf-8") as fh:
        import re
        rev = re.search(r'^REV = "([^"]+)"', open(os.path.join(HERE, "tools", "silk_labels.py")).read(),
                        re.M).group(1)
        fh.write("# Shopping list for TME\n\n")
        fh.write(f"For board **rev {rev}**.\n\n")
        fh.write("The same board, sourced at <https://www.tme.eu/>. Quantities are for one "
                 "board and come straight out of `BOM.csv`.\n\n")
        fh.write("**No prices or stock figures here, on purpose.** TME answers 403 to anything "
                 "automated, so those could not be read and are not going to be guessed. What "
                 "this list gives you is the specification that decides each line, so whichever "
                 "equivalent TME has in stock will be the right one, plus the few symbols that "
                 "were confirmed by hand.\n\n")
        fh.write("| Qty | What it has to be | Where to look | Watch out |\n")
        fh.write("|---:|---|---|---|\n")
        for q, what, where, note in lines:
            fh.write(f"| {q} | {what} | {where} | {note} |\n")
        fh.write("\n## Modules and mechanical\n\n")
        fh.write("| What | Where to look | Watch out |\n|---|---|---|\n")
        for what, where, note in MODULES:
            fh.write(f"| {what} | {where} | {note} |\n")
        fh.write("\nThe five pixel and one supply terminal can be left off entirely: those "
                 "positions have pads big enough to solder the wire onto flat.\n")
    print(f"{len(lines)} Kaufteile + {len(MODULES)} Module -> {os.path.relpath(OUT, HERE)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
