"""Export a JLCPCB-format CPL (pick & place) from the board.
kicad-cli's pos CSV uses Ref,Val,Package,PosX,PosY,Rot,Side with absolute,
Y-flipped coords (Mid Y comes out negative). JLCPCB wants
Designator,Mid X,Mid Y,Layer,Rotation with POSITIVE coords referenced to the
board's bottom-left corner. We export, then offset to bottom-left."""
import subprocess, csv, os, pcbnew

HERE = os.path.dirname(os.path.abspath(__file__))
PCB = os.path.join(HERE, "lumigate_carrier.kicad_pcb")
TMP = os.path.join(HERE, "_cpl_raw.csv")
OUT = os.path.join(HERE, "lumigate_carrier_CPL.csv")
KC = r"C:\Program Files\KiCad\10.0\bin\kicad-cli.exe"

# board edge bottom-left (KiCad coords): x_min, y_max
b = pcbnew.LoadBoard(PCB)
mm = pcbnew.ToMM
ec = [s for s in b.GetDrawings() if s.GetLayer() == pcbnew.Edge_Cuts][0].GetBoundingBox()
x_min, y_max = mm(ec.GetLeft()), mm(ec.GetBottom())

subprocess.run([KC, "pcb", "export", "pos", "-o", TMP, "--format", "csv",
                "--units", "mm", "--side", "both", "--use-drill-file-origin", PCB],
               check=True, capture_output=True)

rows = list(csv.reader(open(TMP)))
idx = {n: i for i, n in enumerate(rows[0])}
out = [["Designator", "Mid X", "Mid Y", "Layer", "Rotation"]]
for r in rows[1:]:
    posx = float(r[idx["PosX"]]); posy = float(r[idx["PosY"]])
    side = r[idx["Side"]].strip().lower()
    midx = posx - x_min          # PosX = kicad_x  -> relative to left edge
    midy = posy + y_max          # PosY = -kicad_y -> y_max - kicad_y (up-positive)
    out.append([r[idx["Ref"]], f"{midx:.4f}mm", f"{midy:.4f}mm",
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
