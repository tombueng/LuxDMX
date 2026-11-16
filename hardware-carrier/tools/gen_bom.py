#!/usr/bin/env python3
"""Generate the bill of materials as Markdown, CSV and XLSX.

Quantities come from the board, sourcing comes from sourcing.json. Keeping them apart means
a moved part changes the count automatically and nobody has to remember to edit a table.

Two sections, because they are bought in different places:
  **LCSC/JLCPCB** for the small stuff (1206, terminals, polyfuse, electrolytic, buffer)
  **Amazon / eBay / AliExpress** for the modules (ESP32, MAX3485, W5500, buck, OLED, encoder)

Marketplace links rot within months. The search terms do not, so both are in the output and
the search terms are the part you should actually rely on.

Fails if a part on the board has no sourcing entry.

Run:  python hardware-carrier/gen_bom.py
"""
import csv
import json
import math
import os
import re
import sys

import pcbnew

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

def _project_dir():
    """The project directory, whether this script sits in it or in tools/ beside it.

    The tooling is deliberately kept out of the git repo (see .gitignore), so it lives one
    level down in tools/. Everything it reads and writes still belongs next to the board."""
    d = os.path.dirname(os.path.abspath(__file__))
    for _ in range(3):
        if os.path.exists(os.path.join(d, "luxdmx-carrier.kicad_pcb")) or \
           os.path.exists(os.path.join(d, "modules.json")):
            return d
        d = os.path.dirname(d)
    return os.path.dirname(os.path.abspath(__file__))


HERE = _project_dir()
BOARD = os.path.join(HERE, "luxdmx-carrier.kicad_pcb")
# sourcing.json is tooling input, not a project file: it lives next to this script
SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sourcing.json")
OUT = os.path.join(HERE, "production")


def generic(val, fpid):
    """Board value -> sourcing key.

    Every 2.54 mm header is the same line item no matter what it is labelled, so the
    decision is made on the FOOTPRINT. The display and encoder labels sit on headers, not on
    the modules themselves: what you solder is a pin header, what you plug in is the module,
    and both have to be bought."""
    if "PinHeader" in fpid:
        return "PinHeader"
    if "header-1x03-P2.54-terminal" in fpid:
        # the DMX rows are drilled 1.20 so they take a screw terminal too, so they are their
        # own line, not just another piece off the header strip
        return "header-1x03-P2.54-terminal"
    v = re.sub(r"^(MAX3485 DMX)\d$", r"\1n", val)
    v = re.sub(r"^PIX\d (.*)", r"PIXn \1", v)
    if v.startswith("MF-R 30V"):
        return "MF-R 30V"
    if v.startswith("DC jack"):
        return "DC jack"
    return v


# JLCPCB matches BOM and CPL on the designator, and wants plain ones (R12, C3). The board's
# references are labels for hand assembly ("330R bias+", three times "10k dir"), which their
# uploader refuses with nothing but "failed to load" (issue #164). So the upload files get
# designators of their own, numbered here, and JLC-designators.csv says which is which.
JLC_PREFIX = {"Resistor": "R", "Capacitor": "C", "Electrolytic": "C", "TVS": "D",
              "Octal": "U", "Screw": "J", "DC": "J", "Polyfuse": "F", "Rotary": "SW",
              "Tact": "SW"}
# Turns on top of KiCad's rotation, per footprint. The DMX land is a pin header footprint
# (pins along Y at 0 degrees), turned 90 on the board; JLCPCB's terminal blocks have their pins
# along X at 0 like the pixel terminals. Another 90 lines the pins up, and the rest of the half
# turn puts the wire entry on the board edge the XLR tails come from, the opposite edge from the
# pixel terminals.
# KiCad draws an SOIC with its pin rows running up and down and pin 1 top left; JLCPCB with
# the rows running across and pin 1 bottom left, a quarter turn the other way (-90 on top).
# On the back the part is seen mirrored, so the same correction turns the other way there.
JLC_ROT_EXTRA = {"header-1x03-P2.54-terminal": 90,
                 "SOIC-20W_7.5x12.8mm_P1.27mm": -90}
# what JLCPCB shows as the footprint; the board's own names say nothing to them
JLC_FOOTPRINT = {"chip-universal": "1206", "chip-universal-tvs": "SOD-123FL"}


def _jlc_fp(fpid):
    name = fpid.split(":")[-1]
    return JLC_FOOTPRINT.get(name, name)


def _jlc_place(f):
    """Where JLCPCB has to put the part: x, y (mm, Y up like the gerbers) and rotation.

    JLCPCB places on the middle of the part. KiCad's through-hole footprints sit on pin 1
    (the 1000 uF can, the polyfuse, the screw terminals), which put them 2.5 to 5 mm off in
    JLCPCB's viewer. So a through-hole part goes to the middle of its holes; SMD footprints
    are drawn around their middle already.

    The polyfuse land has three holes for two lead pitches. The MF-R500 takes the outer
    two, which are 1.2 mm apart in height, so the part is turned to lie along them."""
    extra = JLC_ROT_EXTRA.get(f.GetFPIDAsString().split(":")[-1], 0)
    rot = f.GetOrientationDegrees() + (-extra if f.IsFlipped() else extra)
    # the leads only: the DMX land also has unplated holes for the Phoenix terminal's pegs
    holes = [p.GetPosition() for p in f.Pads() if p.GetDrillSize().x > 0 and p.GetNumber()]
    if not holes:
        pos = f.GetPosition()
        return pcbnew.ToMM(pos.x), -pcbnew.ToMM(pos.y), rot
    # an encoder's mounting posts sit either side of the shaft, which is where it is placed
    posts = [p.GetPosition() for p in f.Pads() if p.GetNumber() == "MP"]
    xs, ys = [h.x for h in posts or holes], [h.y for h in posts or holes]
    x, y = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    if "polyfuse-dual-pitch" in f.GetFPIDAsString():
        a, c = min(holes, key=lambda h: h.x), max(holes, key=lambda h: h.x)
        x, y = (a.x + c.x) / 2, (a.y + c.y) / 2
        # board Y points down, so a hole lower on the board turns the part clockwise
        rot = math.degrees(math.atan2(-(c.y - a.y), c.x - a.x))
    return pcbnew.ToMM(x), -pcbnew.ToMM(y), rot


def write_jlc(board, placed, parts, boards):
    """luxdmx-carrier-bom.csv and luxdmx-carrier-cpl.csv in JLCPCB's format.

    Only what comes from LCSC goes in: the modules and headers are bought elsewhere and
    soldered by hand, so JLCPCB has nothing to place there. Coordinates are in the frame the
    gerbers are plotted in (the drill/aux origin), the same numbers kicad-cli's pos export gives."""
    taken = {f.GetReference() for f in board.GetFootprints()
             if re.match(r"^[A-Z]+[0-9]+$", f.GetReference())}
    org = board.GetDesignSettings().GetAuxOrigin()
    items = []
    for key, f in placed:
        p = parts.get(key)
        if not p or p.get("source", "LCSC") != "LCSC":
            continue
        word = p["desc"].split()[0]
        if word not in JLC_PREFIX:
            raise SystemExit(f"gen_bom: no JLC designator prefix for {key!r} ({p['desc']})")
        x, y, rot = _jlc_place(f)
        x, y = x - pcbnew.ToMM(org.x), y + pcbnew.ToMM(org.y)
        items.append({"prefix": JLC_PREFIX[word], "key": key, "p": p, "label": f.GetReference(),
                      "fp": _jlc_fp(f.GetFPIDAsString()), "x": x, "y": y,
                      "rot": round(rot, 1) % 360,
                      "layer": "Bottom" if f.IsFlipped() else "Top"})
    # numbered top to bottom, left to right within each letter, skipping numbers the board
    # already uses (F1 is the blade fuse holder), so the same board always gives the same names
    items.sort(key=lambda t: (t["prefix"], -round(t["y"], 2), round(t["x"], 2)))
    nxt = {}
    for it in items:
        n = nxt.get(it["prefix"], 1)
        while f"{it['prefix']}{n}" in taken:
            n += 1
        it["ref"] = f"{it['prefix']}{n}"
        nxt[it["prefix"]] = n + 1

    def natural(d):
        return (re.match(r"[A-Z]+", d).group(), int(re.search(r"[0-9]+", d).group()))

    lines = {}
    for it in items:
        p = it["p"]
        mk = (p.get("lcsc") or "", p.get("mpn") or it["key"], it["fp"])
        lines.setdefault(mk, []).append(it)
    bom = []
    for (lcsc, mpn, fp), its in lines.items():
        refs = sorted((i["ref"] for i in its), key=natural)
        # the value, not the position label: "10k dir" and "10k ETH_CS pu" are one 10k reel
        word = its[0]["p"]["desc"].split()[0]
        comment = its[0]["key"].split()[0] if word in ("Resistor", "Capacitor") else mpn
        bom.append({"Comment": comment, "Designator": ",".join(refs), "Footprint": fp,
                    "LCSC Part #": lcsc, "Quantity": len(refs) * boards,
                    "Manufacturer Part Number": mpn, "Description": its[0]["p"]["desc"]})
    bom.sort(key=lambda r: natural(r["Designator"].split(",")[0]))
    # plain UTF-8, no BOM, LF: the safest thing for JLCPCB's parser and still opens in Excel
    with open(os.path.join(OUT, "luxdmx-carrier-bom.csv"), "w", newline="",
              encoding="utf-8") as fh:
        w = csv.DictWriter(fh, lineterminator="\n", fieldnames=[
            "Comment", "Designator", "Footprint", "LCSC Part #", "Quantity",
            "Manufacturer Part Number", "Description"])
        w.writeheader()
        w.writerows(bom)
    with open(os.path.join(OUT, "luxdmx-carrier-cpl.csv"), "w", newline="",
              encoding="utf-8") as fh:
        w = csv.writer(fh, lineterminator="\n")
        w.writerow(["Designator", "Mid X", "Mid Y", "Layer", "Rotation"])
        for it in sorted(items, key=lambda t: natural(t["ref"])):
            w.writerow([it["ref"], f"{it['x']:.4f}mm", f"{it['y']:.4f}mm", it["layer"],
                        f"{it['rot']:g}"])
    # the way back from JLCPCB's names to the labels printed on the board
    with open(os.path.join(OUT, "JLC-designators.csv"), "w", newline="",
              encoding="utf-8") as fh:
        w = csv.writer(fh, lineterminator="\n")
        w.writerow(["Designator", "Board label", "Layer", "Mid X", "Mid Y"])
        for it in sorted(items, key=lambda t: natural(t["ref"])):
            w.writerow([it["ref"], it["label"], it["layer"], f"{it['x']:.4f}mm",
                        f"{it['y']:.4f}mm"])
    return len(bom)


def main():
    src = json.load(open(SRC, encoding="utf-8"))
    parts, modules = src["parts"], src["modules"]
    # bewusst nicht in der Liste, aber trotzdem bekannt: sonst schlaegt das Gate unten an
    ignore = src.get("ignore", {})
    for k, v in parts.items():
        if "same_as" in v:
            parts[k] = dict(parts[v["same_as"]])

    board = pcbnew.LoadBoard(BOARD)
    counts, missing, placed = {}, [], []
    for f in board.GetFootprints():
        val = f.GetValue()
        g = generic(val, f.GetFPIDAsString())
        key = g if (g in parts or g in modules or g in ignore) else \
            (val if val in modules else None)
        if key in ignore:
            continue
        if key is None:
            # headers are all one line item
            missing.append(val)
            continue
        counts[key] = counts.get(key, 0) + 1
        placed.append((key, f))

    # The OLED and the encoder are not footprints, they plug into headers. One each.
    # The OLED is the only part left that is not a footprint of its own; it plugs into a
    # header. The encoder used to be listed the same way, as a KY-040 module on a 5-pin row.
    # It is a footprint now, an EC11 on the carrier, so it counts itself.
    for key, marker in (("OLED SDA/SCL/VCC/GND", "SDA/SCL"),):
        if any(marker in f.GetValue() for f in board.GetFootprints()):
            counts[key] = 1

    if missing:
        print("Ohne Bezugsquelle:")
        for m in sorted(set(missing)):
            print(f"   {m}")
        return 1

    # merge LCSC lines that are the same physical part (three 10k positions, one reel)
    merged = {}
    for key, n in sorted(counts.items()):
        if key not in parts:
            continue
        p = parts[key]
        # Without a part number there is nothing to merge ON: three marketplace parts all
        # answer (None, None) and came out as one line of four pieces reading
        # "fuse holder / EC11 / tact switch".
        mk = (p.get("mpn"), p.get("lcsc")) if (p.get("mpn") or p.get("lcsc")) else (key,)
        if mk in merged:
            merged[mk][1] += n
            merged[mk][2].append(key)
        else:
            merged[mk] = [p, n, [key]]

    rows_l, rows_m = [], []
    for p, n, names in sorted(merged.values(), key=lambda t: t[0]["desc"]):
        if True:
            key = " / ".join(sorted(set(names)))
            rows_l.append({
                "Stk": n, "Bauteil": key, "Beschreibung": p["desc"],
                "Hersteller": p.get("vendor", ""), "MPN": p.get("mpn", ""),
                "LCSC": p.get("lcsc") or "", "Bestand": p.get("stock") or "?",
                "EUR/Stk": p.get("price_eur", ""),
                "EUR gesamt": round(n * (p.get("price_eur") or 0), 2),
                "Link": p.get("url", ""), "Hinweis": p.get("note", ""),
                "_links": p.get("links"), "_source": p.get("source", "LCSC"),
                "_alt": p.get("alternatives"),
            })
    for key, n in sorted(counts.items()):
        if key in modules:
            m = modules[key]
            rows_m.append({
                "Stk": n, "Bauteil": key, "Beschreibung": m["desc"],
                "Suchbegriffe": " | ".join(f"{k}: {v}" for k, v in m["search"].items()),
                "Angebote": len(m["links"]), "Hinweis": m.get("note", ""),
                "_links": m["links"],
            })

    os.makedirs(OUT, exist_ok=True)
    total_l = sum(r["EUR gesamt"] for r in rows_l)

    # ---- Markdown ----------------------------------------------------------------
    L = ["# Bill of materials", "",
         f"Everything fitted: {sum(counts.values())} positions. Quantities come from the board.", "",
         f"LCSC stock checked **{src['_checked']}**. Look again before ordering, it changes "
         "daily.", "",
         src.get("_price_basis", ""), "",
         "## Small parts from LCSC", "",
         "| Qty | Part | Description | MPN | LCSC | Stock | EUR ea. | EUR total |",
         "|---:|---|---|---|---|---:|---:|---:|"]
    for r in rows_l:
        lc = f"[{r['LCSC']}]({r['Link']})" if r["LCSC"] and r["Link"] else (r["LCSC"] or "-")
        L.append(f"| {r['Stk']} | {r['Bauteil']} | {r['Beschreibung']} | `{r['MPN']}` | "
                 f"{lc} | {r['Bestand']} | {r['EUR/Stk']} | {r['EUR gesamt']} |")
    L += ["", f"**Small parts total: about {total_l:.2f} EUR**", ""]
    if ignore:
        L += ["Deliberately not listed:", ""]
        for k, why in ignore.items():
            L.append(f"- **{k}**: {why}")
        L.append("")
    notes = [r for r in rows_l if r["Hinweis"]]
    if notes:
        L += ["### Notes", ""]
        for r in notes:
            L.append(f"- **{r['Bauteil']}**: {r['Hinweis']}")
            # a Kleinteil can carry marketplace links too, when LCSC has nothing suitable
            for plat, title, url, price in r.get("_links") or []:
                L.append(f"  - {plat}: [{title}]({url}) - {price}")
        L.append("")
        for r in rows_l:
            if not r.get("_alt"):
                continue
            L += [f"### What may go in the {r['Bauteil']} position, and what may not", ""]
            for head, grp in r["_alt"].items():
                # a group is either a plain list of rows or {cols, rows}: the column headings
                # differ per table, a resistor ladder is not a chip family list
                cols = grp.get("cols") if isinstance(grp, dict) else None
                rows = grp["rows"] if isinstance(grp, dict) else grp
                cols = cols or ["Type", "", "", "Why"]
                L += [f"**{head}**", "",
                      "| " + " | ".join(cols) + " |",
                      "|" + "---|" * len(cols)]
                for row in rows:
                    L.append("| `" + str(row[0]) + "` | " +
                             " | ".join(str(x) for x in row[1:]) + " |")
                L.append("")

    L += ["## Modules from Amazon / eBay / AliExpress", "",
          "The links are examples from " + src["_checked"] +
          " and will rot. The **search terms** are the durable part.", ""]
    for r in rows_m:
        L += [f"### {r['Stk']} x {r['Bauteil']}", "", r["Beschreibung"], "",
              "| Platform | Search term |", "|---|---|"]
        for k, v in modules[r["Bauteil"]]["search"].items():
            L.append(f"| {k} | `{v}` |")
        L += ["", "| Platform | Offer | Price |", "|---|---|---|"]
        for plat, title, url, price in r["_links"]:
            L.append(f"| {plat} | [{title}]({url}) | {price} |")
        if r["Hinweis"]:
            L += ["", f"> {r['Hinweis']}"]
        L.append("")

    open(os.path.join(OUT, "BOM.md"), "w", encoding="utf-8").write("\n".join(L) + "\n")

    # ---- CSV ---------------------------------------------------------------------
    csv_rows = []
    for r in rows_l:
        csv_rows.append({"Group": "LCSC", "Qty": r["Stk"], "Part": r["Bauteil"],
                         "Description": r["Beschreibung"], "Manufacturer": r["Hersteller"],
                         "MPN": r["MPN"], "LCSC": r["LCSC"], "Stock": r["Bestand"],
                         "EUR ea": r["EUR/Stk"], "EUR total": r["EUR gesamt"],
                         "Source": r["Link"], "Note": r["Hinweis"]})
    for r in rows_l:
        for plat, title, url, price in r.get("_links") or []:
            csv_rows.append({"Group": plat, "Qty": r["Stk"], "Part": r["Bauteil"],
                             "Description": r["Beschreibung"], "Manufacturer": "",
                             "MPN": "", "LCSC": "", "Stock": "",
                             "EUR ea": price, "EUR total": "",
                             "Source": url, "Note": title})
    for r in rows_m:
        for plat, title, url, price in r["_links"]:
            csv_rows.append({"Group": plat, "Qty": r["Stk"], "Part": r["Bauteil"],
                             "Description": r["Beschreibung"], "Manufacturer": "",
                             "MPN": "", "LCSC": "", "Stock": "",
                             "EUR ea": price, "EUR total": "",
                             "Source": url, "Note": title})
    cols = ["Group", "Qty", "Part", "Description", "Manufacturer", "MPN", "LCSC",
            "Stock", "EUR ea", "EUR total", "Source", "Note"]
    with open(os.path.join(OUT, "BOM.csv"), "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=cols)
        w.writeheader()
        w.writerows(csv_rows)

    # ---- JLCPCB / LCSC upload: BOM + placement ----------------------------------
    boards = int(sys.argv[sys.argv.index("--boards") + 1]) if "--boards" in sys.argv else 1
    n_up = write_jlc(board, placed, parts, boards)
    import check_jlc_files
    errors, warnings = check_jlc_files.check(OUT)
    for w in warnings:
        print("  warn: " + w)
    for e in errors:
        print("  FEHLER: " + e)
    if errors:
        print("JLC-Dateien kaputt, siehe oben")
        return 1

    # ---- XLSX --------------------------------------------------------------------
    try:
        from openpyxl import Workbook
        from openpyxl.styles import Font, Alignment
        wb = Workbook()
        ws = wb.active
        ws.title = "LCSC"
        ws.append(cols[:-2] + ["Quelle", "Hinweis"])
        for c in ws[1]:
            c.font = Font(bold=True)
        for r in csv_rows:
            if r["Group"] == "LCSC":
                ws.append([r[c] for c in cols])
        ws2 = wb.create_sheet("Module")
        ws2.append(["Platform", "Qty", "Part", "Offer", "Price", "Link"])
        for c in ws2[1]:
            c.font = Font(bold=True)
        for r in csv_rows:
            if r["Group"] != "LCSC":
                ws2.append([r["Group"], r["Qty"], r["Part"], r["Note"],
                            r["EUR ea"], r["Source"]])
        ws3 = wb.create_sheet("Search terms")
        ws3.append(["Part", "Platform", "Search term"])
        for c in ws3[1]:
            c.font = Font(bold=True)
        for r in rows_m:
            for k, v in modules[r["Bauteil"]]["search"].items():
                ws3.append([r["Bauteil"], k, v])
        for sheet in (ws, ws2, ws3):
            for col in sheet.columns:
                width = max(len(str(c.value or "")) for c in col)
                sheet.column_dimensions[col[0].column_letter].width = min(width + 2, 60)
                for c in col:
                    c.alignment = Alignment(vertical="top", wrap_text=True)
        wb.save(os.path.join(OUT, "BOM.xlsx"))
        xl = "BOM.xlsx"
    except ImportError:
        xl = "(openpyxl fehlt)"

    print(f"{len(rows_l)} LCSC-Positionen ({total_l:.2f} EUR), {len(rows_m)} Module")
    print(f"-> production/BOM.md, BOM.csv, {xl}, luxdmx-carrier-bom.csv "
          f"({n_up} Zeilen fuer {boards} Board(s)), luxdmx-carrier-cpl.csv, JLC-designators.csv")
    return 0


if __name__ == "__main__":
    sys.exit(main())
