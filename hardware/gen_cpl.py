"""Export a JLCPCB-format CPL (pick & place) from the board.

The board has its auxiliary (drill/place) origin set to the bottom-left corner, so
kicad-cli's pos export with --use-drill-file-origin already yields POSITIVE coords
relative to that corner — matching the gerbers (also exported --use-drill-file-origin)
and JLCPCB's expectation. We just rename headers to Designator/Mid X/Mid Y/Layer/Rotation."""
import subprocess, csv, os

HERE = os.path.dirname(os.path.abspath(__file__))
PCB = os.path.join(HERE, "lumigate_carrier.kicad_pcb")
TMP = os.path.join(HERE, "_cpl_raw.csv")
OUT = os.path.join(HERE, "lumigate_carrier_CPL.csv")
KC = r"C:\Program Files\KiCad\10.0\bin\kicad-cli.exe"

subprocess.run([KC, "pcb", "export", "pos", "-o", TMP, "--format", "csv",
                "--units", "mm", "--side", "both", "--use-drill-file-origin", PCB],
               check=True, capture_output=True)

rows = list(csv.reader(open(TMP)))
idx = {n: i for i, n in enumerate(rows[0])}
out = [["Designator", "Mid X", "Mid Y", "Layer", "Rotation"]]
for r in rows[1:]:
    posx = float(r[idx["PosX"]]); posy = float(r[idx["PosY"]])
    side = r[idx["Side"]].strip().lower()
    out.append([r[idx["Ref"]], f"{posx:.4f}mm", f"{posy:.4f}mm",
                "Top" if side.startswith("t") else "Bottom", f"{float(r[idx['Rot']]):.0f}"])
with open(OUT, "w", newline="") as f:
    csv.writer(f).writerows(out)
os.remove(TMP)

# also emit .xlsx (JLCPCB's preferred CPL format; matches their sample cell types)
try:
    import openpyxl
    wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Sheet1"
    ws.append(out[0])
    for r in out[1:]:
        ws.append([r[0], r[1], r[2], r[3], int(float(r[4]))])
    wb.save(OUT.replace(".csv", ".xlsx"))
except ImportError:
    pass

print(f"JLCPCB CPL written: {len(out)-1} placements (bottom-left origin, positive coords)")
print("sample:", out[1])
