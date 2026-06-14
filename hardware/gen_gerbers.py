"""Export JLCPCB gerbers + drill from the board and zip them — ALWAYS with the AUX
(drill/place) ORIGIN.  Board-safe: kicad-cli is read-only, this does NOT rebuild the
board (unlike build_v3.py).

    py gen_gerbers.py            # -> lumigate_gerbers.zip

WHY THIS EXISTS / THE TRAP:
gerbers and the CPL (gen_cpl.py) MUST share the same coordinate origin, or JLCPCB
places every component ~98 mm off the board ("components far outside the board").
gen_cpl.py emits placements relative to the board's AUX origin (bottom-left), so the
gerbers MUST be plotted with --use-drill-file-origin / --drill-origin plot.  A plain
GUI plot in ABSOLUTE page coordinates is exactly the regression this script prevents.
"""
import os, glob, shutil, tempfile, zipfile, subprocess

HERE   = os.path.dirname(os.path.abspath(__file__))
PCB    = os.path.join(HERE, "lumigate.kicad_pcb")
ZIP    = os.path.join(HERE, "lumigate_gerbers.zip")
LAYERS = "F.Cu,In1.Cu,In2.Cu,B.Cu,F.Mask,B.Mask,F.Paste,B.Paste,F.Silkscreen,B.Silkscreen,Edge.Cuts"

CLI = os.environ.get("KICAD_CLI")
if not CLI or not os.path.exists(CLI):
    for c in (r"C:\Program Files\KiCad\10.0\bin\kicad-cli.exe",
              r"C:\Program Files\KiCad\9.0\bin\kicad-cli.exe",
              shutil.which("kicad-cli")):
        if c and os.path.exists(c):
            CLI = c; break
    else:
        raise SystemExit("kicad-cli not found - set $KICAD_CLI")

tmp = tempfile.mkdtemp(prefix="lumigate_gbr_")
try:
    subprocess.run([CLI, "pcb", "export", "gerbers", PCB, "-o", tmp + os.sep,
                    "--use-drill-file-origin", "--no-protel-ext", "--layers", LAYERS],
                   check=True, capture_output=True, text=True)
    subprocess.run([CLI, "pcb", "export", "drill", PCB, "-o", tmp + os.sep,
                    "--drill-origin", "plot", "--format", "excellon",
                    "--excellon-units", "mm", "--excellon-separate-th"],
                   check=True, capture_output=True, text=True)
    files = sorted(sum((glob.glob(os.path.join(tmp, e)) for e in ("*.gbr", "*.drl", "*.gbrjob")), []))
    with zipfile.ZipFile(ZIP, "w", zipfile.ZIP_DEFLATED) as z:
        for f in files:
            z.write(f, os.path.basename(f))
    print(f"gerbers zipped (AUX origin): {len(files)} files -> {os.path.basename(ZIP)}")
finally:
    shutil.rmtree(tmp, ignore_errors=True)
