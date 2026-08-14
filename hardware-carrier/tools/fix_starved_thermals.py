#!/usr/bin/env python3
"""Give a solid zone connection to the pads whose thermal relief cannot form.

GND is poured with thermal spokes on purpose: 47 ground pads with a solid connection are a
misery to hand solder, the pour sinks the heat faster than the iron delivers it. But a spoke
needs clear board around the pad to reach the zone, and a few pads do not have it: the ones
that moved to the board edge, and the big terminal pads whose copper now covers most of the
space a spoke would have used. KiCad calls that a starved thermal and it is a real error, the
pad is only partly connected.

Rather than dropping thermals everywhere, this switches only the pads that actually starve,
which KiCad's own DRC identifies. Those pads are the fat ones anyway, soldered with a big
iron and a fat wire, so a solid connection costs nothing there.

Iterates: filling changes the geometry, so a fixed pad can expose the next one.

Run:  python tools/fix_starved_thermals.py
"""
import json
import os
import subprocess
import sys
import tempfile

import pcbnew

TOL = 0.05
ROUNDS = 4


def _project_dir():
    d = os.path.dirname(os.path.abspath(__file__))
    for _ in range(3):
        if os.path.exists(os.path.join(d, "luxdmx-carrier.kicad_pcb")):
            return d
        d = os.path.dirname(d)
    return os.path.dirname(os.path.abspath(__file__))


BOARD = os.path.join(_project_dir(), "luxdmx-carrier.kicad_pcb")


def starved(path):
    out = os.path.join(tempfile.mkdtemp(), "drc.json")
    subprocess.run(["kicad-cli", "pcb", "drc", "--format", "json", "--output", out,
                    "--severity-error", path], capture_output=True, text=True)
    d = json.load(open(out, encoding="utf-8"))
    hits = []
    for v in d.get("violations", []):
        if v.get("type") != "starved_thermal":
            continue
        for it in v.get("items", []):
            if it.get("description", "").startswith(("Durchsteckpad", "Pad", "Through hole pad",
                                                     "SMD-Pad", "SMD pad")):
                hits.append((it["pos"]["x"], it["pos"]["y"]))
    return hits, len(d.get("violations", []))


def main():
    fixed = 0
    for rnd in range(ROUNDS):
        hits, total = starved(BOARD)
        print(f"Runde {rnd + 1}: {total} DRC-Verstoesse, {len(hits)} ausgehungerte Waermefallen")
        if not hits:
            break
        b = pcbnew.LoadBoard(BOARD)
        for f in b.GetFootprints():
            for p in f.Pads():
                px, py = pcbnew.ToMM(p.GetPosition().x), pcbnew.ToMM(p.GetPosition().y)
                if any(abs(hx - px) < TOL and abs(hy - py) < TOL for hx, hy in hits):
                    p.SetLocalZoneConnection(pcbnew.ZONE_CONNECTION_FULL)
                    print(f"  massiv angebunden: {f.GetReference()[:26]} Pad {p.GetNumber()} "
                          f"bei ({px:.2f}, {py:.2f})")
                    fixed += 1
        pcbnew.ZONE_FILLER(b).Fill(b.Zones())
        pcbnew.SaveBoard(BOARD, b)
    print(f"{fixed} Pads massiv angebunden")
    return 0


if __name__ == "__main__":
    sys.exit(main())
