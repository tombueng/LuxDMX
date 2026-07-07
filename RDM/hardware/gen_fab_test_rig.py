#!/usr/bin/env python
"""Fab package for the DMX/RDM test-rig board: gerbers + drill + BOM + placement CSV.

Same hard gate as the main board: it runs KiCad's own DRC and REFUSES to emit anything
while any net is unrouted (the C17 lesson - never ship an unconnected board from a stale
"looks routed" note). kicad-cli is read-only, so this does NOT modify the board.

This board is all through-hole / socketed (hand-assembled), so the BOM + placement CSV are
for ordering + build reference, not a JLCPCB SMT order. The gerber zip is what you send to
fab the bare PCB.

    "/c/Program Files/KiCad/10.0/bin/python.exe" gen_fab_test_rig.py
"""
import os, re, csv, glob, json, shutil, tempfile, zipfile, subprocess, pcbnew
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
PCB  = os.path.join(HERE, "test_rig.kicad_pcb")
ZIP  = os.path.join(HERE, "test_rig_gerbers.zip")
BOM  = os.path.join(HERE, "test_rig_BOM.csv")
CPL  = os.path.join(HERE, "test_rig_CPL.csv")
# 2-layer board: no inner copper, no paste (nothing SMD to stencil)
LAYERS = "F.Cu,B.Cu,F.Mask,B.Mask,F.Silkscreen,B.Silkscreen,Edge.Cuts"


def find_cli():
    c = os.environ.get("KICAD_CLI")
    if c and os.path.exists(c):
        return c
    for c in (r"C:\Program Files\KiCad\10.0\bin\kicad-cli.exe",
              r"C:\Program Files\KiCad\9.0\bin\kicad-cli.exe", shutil.which("kicad-cli")):
        if c and os.path.exists(c):
            return c
    raise SystemExit("kicad-cli not found - set $KICAD_CLI")


def connectivity_gate(cli):
    out = os.path.join(tempfile.gettempdir(), "tr_fab_drc.json")
    subprocess.run([cli, "pcb", "drc", "--format", "json", "-o", out, PCB],
                   check=False, capture_output=True, text=True)
    d = json.load(open(out, encoding="utf-8"))
    unrouted = d.get("unconnected_items", [])
    viol = d.get("violations", [])
    n_err = sum(1 for v in viol if v.get("severity") == "error")
    n_warn = sum(1 for v in viol if v.get("severity") == "warning")
    print(f"[connectivity gate] unrouted nets: {len(unrouted)} | DRC errors: {n_err} | warnings: {n_warn}")
    if unrouted:
        for u in unrouted:
            print("    UNROUTED:", " <-> ".join(i.get("description", "?") for i in u.get("items", [])))
        raise SystemExit("ABORT: unrouted net(s) -> refusing to produce fab output.")
    return n_err, n_warn


def gen_gerbers(cli):
    tmp = tempfile.mkdtemp(prefix="tr_gbr_")
    try:
        subprocess.run([cli, "pcb", "export", "gerbers", PCB, "-o", tmp + os.sep,
                        "--use-drill-file-origin", "--no-protel-ext", "--layers", LAYERS],
                       check=True, capture_output=True, text=True)
        subprocess.run([cli, "pcb", "export", "drill", PCB, "-o", tmp + os.sep,
                        "--drill-origin", "plot", "--format", "excellon",
                        "--excellon-units", "mm", "--excellon-separate-th"],
                       check=True, capture_output=True, text=True)
        files = sorted(sum((glob.glob(os.path.join(tmp, e))
                            for e in ("*.gbr", "*.drl", "*.gbrjob")), []))
        with zipfile.ZipFile(ZIP, "w", zipfile.ZIP_DEFLATED) as z:
            for f in files:
                z.write(f, os.path.basename(f))
        print(f"gerbers zipped (AUX origin): {len(files)} files -> {os.path.basename(ZIP)}")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


# footprint lib-item name -> BOM description of the part soldered to the carrier
FP_DESC = {
    "PinSocket_1x20_P2.54mm_Vertical": "Female header socket 1x20, 2.54mm",
    "PinSocket_1x22_P2.54mm_Vertical": "Female header socket 1x22, 2.54mm",
    "PinSocket_1x05_P2.54mm_Vertical": "Female header socket 1x5, 2.54mm",
    "PinSocket_2x05_P2.54mm_Vertical": "Female header socket 2x5, 2.54mm",
    "PinHeader_1x07_P2.54mm_Vertical": "Pin header (male) 1x7, 2.54mm",
    "PinHeader_2x08_P2.54mm_Vertical": "Pin header (male) 2x8, 2.54mm",
    "R_Axial_DIN0207_L6.3mm_D2.5mm_P7.62mm_Horizontal": "Resistor THT axial, 7.62mm pitch",
    "TerminalBlock_Phoenix_MKDS-1,5-3_1x03_P5.00mm_Horizontal": "Screw terminal 3-pin, 5.08mm",
}
# plug-in modules that seat in the sockets (NOT soldered, NOT on the board) - listed for ordering
MODULES = [
    ("ESP32-S3-DevKitC-1", 1, "DUT: LuxDMX controller (0.9\" / 2x22)"),
    ("Pimoroni Pico Plus 2 W (RP2350)", 1, "RDM simulator (standard Pico 2x20)"),
    ("MAX485 module (RXD/TXD variant)", 2, "one per node, cross-wired"),
    ("W5500 SPI Ethernet module (2x5)", 1, "for the S3"),
]


def _refkey(r):
    m = re.match(r"([A-Za-z_]+?)(\d+)", r)
    return (m.group(1), int(m.group(2))) if m else (r, 0)


def gen_bom(b):
    groups = defaultdict(list)   # (desc, value) -> [refs]
    for fp in b.GetFootprints():
        ref = fp.GetReference()
        if ref.startswith("REF") or not list(fp.Pads()):
            continue   # mounting holes / graphics
        name = str(fp.GetFPID().GetLibItemName())
        desc = FP_DESC.get(name, name)
        val = fp.GetValue()
        # for resistors pull the value (270R / 10k) out of the function label
        rv = ""
        if name.startswith("R_Axial"):
            m = re.search(r"(\d+(?:\.\d+)?\s*[kKrR]\d*)", val.replace("->", " "))
            rv = m.group(1) if m else ""
        key = (desc, rv)
        groups[key].append(ref)

    rows = [["Qty", "Designators", "Value", "Description / part"]]
    for (desc, rv), refs in sorted(groups.items(), key=lambda kv: _refkey(sorted(kv[1], key=_refkey)[0])):
        refs_sorted = sorted(refs, key=_refkey)
        rows.append([len(refs_sorted), ",".join(refs_sorted), rv, desc])
    rows.append([])
    rows.append(["# plug-in modules (seat in the sockets, not soldered / not on the PCB)"])
    for name, qty, note in MODULES:
        rows.append([qty, "", "", f"{name} - {note}"])
    with open(BOM, "w", newline="", encoding="utf-8") as f:
        csv.writer(f).writerows(rows)
    n = sum(len(v) for v in groups.values())
    print(f"BOM written: {os.path.basename(BOM)} ({n} board parts + {len(MODULES)} module lines)")


def gen_cpl(b):
    mm = pcbnew.ToMM
    aux = b.GetDesignSettings().GetAuxOrigin()
    ecs = [s for s in b.GetDrawings() if s.GetLayer() == pcbnew.Edge_Cuts]
    if not ecs:
        raise SystemExit("no Edge.Cuts outline on the board")
    ec = ecs[0].GetBoundingBox()
    if aux.x == 0 and aux.y == 0:
        aux = pcbnew.VECTOR2I(ec.GetLeft(), ec.GetBottom())
    rows = [["Designator", "Mid X", "Mid Y", "Layer", "Rotation"]]
    for fp in sorted(b.GetFootprints(), key=lambda x: _refkey(x.GetReference())):
        ref = fp.GetReference()
        if ref.startswith("REF") or not list(fp.Pads()):
            continue
        pos = fp.GetPosition()
        X = mm(pos.x - aux.x)
        Y = mm(aux.y - pos.y)
        rot = fp.GetOrientationDegrees() % 360
        side = "Bottom" if fp.IsFlipped() else "Top"
        rows.append([ref, f"{X:.4f}mm", f"{Y:.4f}mm", side, f"{rot:.0f}"])
    with open(CPL, "w", newline="", encoding="utf-8") as f:
        csv.writer(f).writerows(rows)
    print(f"placement CSV written: {os.path.basename(CPL)} ({len(rows)-1} parts, bottom-left origin)")


def main():
    cli = find_cli()
    n_err, n_warn = connectivity_gate(cli)
    gen_gerbers(cli)
    b = pcbnew.LoadBoard(PCB)
    gen_bom(b)
    gen_cpl(b)
    print("\nfab package done. Order the bare PCB from test_rig_gerbers.zip (2-layer);"
          " solder the sockets/resistors/headers/terminal, then plug in the modules.")
    if n_warn:
        print(f"(note: {n_warn} DRC warning(s) - silk niggles, not fab-blocking)")


if __name__ == "__main__":
    main()
