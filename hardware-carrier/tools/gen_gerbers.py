#!/usr/bin/env python3
"""Export JLCPCB gerbers, drill and the placement file, and zip them.

Same conventions as the main board (hardware/scripts/gen_gerbers.py): plotted against the
**drill/place origin**, not page coordinates. Gerbers and the CPL have to share one origin or
JLCPCB places every part about 98 mm off the board.

Hard gate: nothing is written while a net is unconnected or a copper DRC rule is violated.
Silk violations are reported but do not block, they are cosmetic and this board has 40 of
them by design (the screw terminals overhang the outline).

Run:  python hardware-carrier/gen_gerbers.py
"""
import glob
import json
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile

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
VARIANT = sys.argv[sys.argv.index("--board") + 1] if "--board" in sys.argv \
    else "luxdmx-carrier.kicad_pcb"
PCB = os.path.join(HERE, VARIANT)
STEM = os.path.splitext(VARIANT)[0]
OUT = os.path.join(HERE, "production")
def _layers():
    """Inner layers only exist on the 4-layer variant."""
    inner = ",In1.Cu,In2.Cu" if "4layer" in VARIANT else ""
    return ("F.Cu" + inner + ",B.Cu,F.Mask,B.Mask,F.Paste,B.Paste,"
            "F.Silkscreen,B.Silkscreen,Edge.Cuts")


LAYERS = _layers()
CLI = shutil.which("kicad-cli") or "/usr/bin/kicad-cli"


def run(*a):
    r = subprocess.run(a, capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(f"{' '.join(a[:4])} fehlgeschlagen:\n{r.stdout}\n{r.stderr}")
    return r.stdout


def gate():
    """No gerbers while the board is not actually finished."""
    tmp = os.path.join(tempfile.gettempdir(), "carrier-drc-gate.json")
    run(CLI, "pcb", "drc", "--format", "json", "-o", tmp, PCB)
    d = json.load(open(tmp))
    un = d.get("unconnected_items") or []
    v = d.get("violations") or []
    copper = [x for x in v if not x["type"].startswith("silk") and x["type"] != "text_height"]
    print(f"Gate: {len(un)} unverbunden, {len(copper)} Kupferverstoesse, "
          f"{len(v) - len(copper)} Silk-Hinweise")
    if un or copper:
        for x in copper[:10]:
            print(f"   {x['type']}: {x.get('description','')[:80]}")
        raise SystemExit("Board ist nicht fabrikfertig, keine Gerbers erzeugt.")


def main():
    if not os.path.exists(CLI):
        raise SystemExit("kicad-cli nicht gefunden")
    gate()

    os.makedirs(OUT, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix="carrier_gbr_")
    try:
        run(CLI, "pcb", "export", "gerbers", PCB, "-o", tmp + os.sep,
            "--use-drill-file-origin", "--no-protel-ext", "--layers", LAYERS)
        run(CLI, "pcb", "export", "drill", PCB, "-o", tmp + os.sep,
            "--drill-origin", "plot", "--format", "excellon",
            "--excellon-units", "mm", "--excellon-separate-th")
        files = sorted(sum((glob.glob(os.path.join(tmp, e))
                            for e in ("*.gbr", "*.drl", "*.gbrjob")), []))
        zp = os.path.join(OUT, STEM + "-gerbers.zip")
        with zipfile.ZipFile(zp, "w", zipfile.ZIP_DEFLATED) as z:
            for f in files:
                z.write(f, os.path.basename(f))
        print(f"\n{len(files)} Dateien -> {os.path.relpath(zp, HERE)}")
        for f in files:
            print(f"   {os.path.basename(f):44s} {os.path.getsize(f)//1024:4d} kB")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    # placement file, same origin as the gerbers
    run(CLI, "pcb", "export", "pos", PCB, "-o", os.path.join(OUT, STEM + "-cpl.csv"),
        "--format", "csv", "--units", "mm", "--use-drill-file-origin", "--side", "both")
    print(f"   {STEM}-cpl.csv")
    return 0


if __name__ == "__main__":
    sys.exit(main())
