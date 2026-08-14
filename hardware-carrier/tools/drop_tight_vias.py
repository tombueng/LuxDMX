#!/usr/bin/env python3
"""Remove router vias on poured nets that DRC reports as too close to something.

Freerouting places the fat 1000 um power via but does its clearance arithmetic on the stock
600 um one, so a via it believes is 300 um clear of a pad lands 100 um clear in KiCad. Padding
the class clearance to compensate was tried: routing came out strictly worse, 6 connections
open instead of 1, and the via stayed anyway.

Dropping the via costs nothing, and that is the point: GND, V_PIX and V_PIX_IN are carried by
the pours on both layers, so a via on one of those nets is a convenience, not a connection.
Vias on any other net are left in place and reported, because there one would be load bearing
and the fix has to be a real one.

Which vias are too close is decided by KiCad's own DRC, not by arithmetic here. Pad shapes are
rounded rectangles, ovals and custom polygons, and a bounding box is not close enough: a first
version of this used one and flagged a via that DRC is perfectly happy with while missing the
one it complains about.

Run after autoroute, before build_zones.

Run:  python tools/drop_tight_vias.py
"""
import json
import os
import subprocess
import sys
import tempfile

import pcbnew

POURED = {"GND", "V_PIX", "V_PIX_IN"}
TOL = 0.02          # mm, matching a DRC position to a via position


def _project_dir():
    d = os.path.dirname(os.path.abspath(__file__))
    for _ in range(3):
        if os.path.exists(os.path.join(d, "luxdmx-carrier.kicad_pcb")):
            return d
        d = os.path.dirname(d)
    return os.path.dirname(os.path.abspath(__file__))


BOARD = os.path.join(_project_dir(), "luxdmx-carrier.kicad_pcb")


def drc_clearance_hits(board_path):
    """Every (x, y) that DRC names in a clearance violation."""
    out = os.path.join(tempfile.mkdtemp(), "drc.json")
    subprocess.run(["kicad-cli", "pcb", "drc", "--format", "json", "--output", out,
                    "--severity-error", board_path], capture_output=True, text=True)
    d = json.load(open(out, encoding="utf-8"))
    hits = []
    for v in d.get("violations", []):
        if v.get("type") != "clearance":
            continue
        for it in v.get("items", []):
            hits.append((it["pos"]["x"], it["pos"]["y"], it.get("description", "")))
    return hits, len(d.get("violations", []))


def main():
    hits, total = drc_clearance_hits(BOARD)
    print(f"DRC: {total} Verstoesse, davon {len(hits)} Positionen aus Abstandsverstoessen")
    if not hits:
        print("nichts zu tun")
        return 0

    b = pcbnew.LoadBoard(BOARD)
    drop, keep, locked = [], [], []
    for t in list(b.GetTracks()):
        if t.GetClass() != "PCB_VIA":
            continue
        if t.IsLocked():
            # stitching vias are locked so the router leaves them alone. They are rebuilt by
            # stitch_vias.py, which does its own clearance check, so this is not the place to
            # touch them. Report rather than pass silently: a guard that says nothing while a
            # violation stands is worse than no guard.
            vx, vy = pcbnew.ToMM(t.GetPosition().x), pcbnew.ToMM(t.GetPosition().y)
            if any(abs(hx - vx) < TOL and abs(hy - vy) < TOL for hx, hy, _ in hits):
                locked.append((t.GetNetname(), vx, vy))
            continue
        vx, vy = pcbnew.ToMM(t.GetPosition().x), pcbnew.ToMM(t.GetPosition().y)
        for hx, hy, _ in hits:
            if abs(hx - vx) < TOL and abs(hy - vy) < TOL:
                (drop if t.GetNetname() in POURED else keep).append((t, t.GetNetname(), vx, vy))
                break

    for t, net, vx, vy in drop:
        print(f"  weg: Via [{net}] bei ({vx:.2f}, {vy:.2f}), die Zone traegt das Netz")
        b.Remove(t)
    for _, net, vx, vy in keep:
        print(f"  BLEIBT: Via [{net}] bei ({vx:.2f}, {vy:.2f}) - kein Zonennetz, "
              f"das muss von Hand geloest werden")
    pcbnew.SaveBoard(BOARD, b)
    for net, vx, vy in locked:
        print(f"  gesperrt: Naehvia [{net}] bei ({vx:.2f}, {vy:.2f}) - gehoert "
              f"stitch_vias.py, wird dort neu gesetzt")
    print(f"{len(drop)} Vias entfernt, {len(keep)} von Hand zu klaeren, "
          f"{len(locked)} gesperrte an stitch_vias.py verwiesen")
    return 1 if keep else 0


if __name__ == "__main__":
    sys.exit(main())
