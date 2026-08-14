#!/usr/bin/env python3
"""Set net classes before anything gets routed.

The project shipped with a single Default class at 0.2 mm. Autorouting on that would give
the 12/24 V rail the same copper as an I2C line, which at 20 A is a heater, not a track.

Widths come from IPC-2221 for an external layer, I = 0.048 * dT^0.44 * A^0.725, at a 10 K
rise. The numbers, in mm:

           1 A   3 A   5 A   9 A  20 A
    1 oz   0.3   1.4   2.8   6.3  18.9
    2 oz   0.2   0.7   1.4   3.1   9.4

So the pixel rail is not a track at all, it is a pour on both layers, and the width set here
is only what a stub between the pour and a pad gets. GND is the same current on the way back.

Run:  python hardware-carrier/set_netclasses.py [--dry-run]
"""
import json
import os
import sys

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
PRO = os.path.join(HERE, "luxdmx-carrier.kicad_pro")

BASE = {
    "bus_width": 12, "diff_pair_gap": 0.25, "diff_pair_via_gap": 0.25,
    "diff_pair_width": 0.2, "line_style": 0, "microvia_diameter": 0.3,
    "microvia_drill": 0.1, "pcb_color": "rgba(0, 0, 0, 0.000)",
    "schematic_color": "rgba(0, 0, 0, 0.000)", "tuning_profile": "", "wire_width": 6,
}

# track_width here is the MINIMUM a router may use, the real copper for Power comes from the
# zones. Vias scale with the current they have to carry.
CLASSES = [
    # name        clear  track  via_d via_dr  priority
    ("Power",     0.30,  1.50,  1.00, 0.50,   10),   # V_PIX_IN / V_PIX / GND, Flaechen tragen den Strom
    ("Rail5V",    0.25,  1.50,  0.80, 0.40,   20),   # buck out, ESP + modules + buffer
    ("Rail3V3",   0.25,  0.80,  0.60, 0.30,   30),   # ESP LDO out, W5500 + 485 + display
    ("Default",   0.20,  0.35,  0.60, 0.30,   2147483647),
]

PATTERNS = [
    ("V_PIX_IN", "Power"), ("V_PIX", "Power"), ("GND", "Power"),
    ("+5V", "Rail5V"), ("+3V3", "Rail3V3"),
]


def main():
    dry = "--dry-run" in sys.argv
    pro = json.load(open(PRO, encoding="utf-8"))
    ns = pro["net_settings"]

    ns["classes"] = [dict(BASE, name=n, clearance=c, track_width=t,
                          via_diameter=vd, via_drill=vdr, priority=pr)
                     for n, c, t, vd, vdr, pr in CLASSES]
    ns["netclass_patterns"] = [{"pattern": p, "netclass": c} for p, c in PATTERNS]

    print("Netzklassen:")
    for n, c, t, vd, vdr, _ in CLASSES:
        nets = [p for p, k in PATTERNS if k == n] or ["alles uebrige"]
        print(f"  {n:9s} Bahn {t:4.2f}  Abstand {c:4.2f}  Via {vd}/{vdr}   "
              f"{', '.join(nets)}")

    # design rules have to allow the smallest thing any class asks for
    dr = pro.setdefault("board", {}).setdefault("design_settings", {}).setdefault("rules", {})
    before = dict(dr)
    dr["min_track_width"] = min(c[2] for c in CLASSES)
    dr["min_clearance"] = min(c[1] for c in CLASSES)
    dr["min_via_diameter"] = min(c[3] for c in CLASSES)
    dr["min_through_hole_diameter"] = min(dr.get("min_through_hole_diameter", 0.3), 0.3)
    changed = {k: (before.get(k), v) for k, v in dr.items() if before.get(k) != v}
    if changed:
        print("\nDesign Rules angepasst:")
        for k, (a, v) in changed.items():
            print(f"  {k}: {a} -> {v}")

    if not dry:
        with open(PRO, "w", encoding="utf-8") as fh:
            json.dump(pro, fh, indent=2)
            fh.write("\n")
        print(f"\ngespeichert: {os.path.basename(PRO)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
