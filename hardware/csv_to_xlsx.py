"""CSV -> XLSX for the JLCPCB BOM/CPL uploads, using openpyxl (a real, fully-valid OOXML file).

We do NOT hand-roll the .xlsx: a minimal inline-string workbook (no styles.xml/docProps) parses in
Excel but JLCPCB's uploader rejects it ("Failed processing the CPL file"). openpyxl writes the complete
package, which JLCPCB accepts. If openpyxl is missing we raise instead of emitting a half-valid file --
the .csv is always written too and JLCPCB accepts that directly, so a missing-xlsx is never a blocker.
Usage: csv_to_xlsx.py in.csv out.xlsx   (or import convert())."""
import csv, sys


def convert(csv_path, xlsx_path):
    import openpyxl                                   # hard dependency on purpose (see module docstring)
    rows = list(csv.reader(open(csv_path, newline="", encoding="utf-8")))
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Sheet1"
    for r in rows:
        ws.append(r)
    wb.save(xlsx_path)
    return len(rows)


if __name__ == "__main__":
    n = convert(sys.argv[1], sys.argv[2])
    print(f"wrote {sys.argv[2]} ({n} rows)")
