#!/usr/bin/env python3
"""Audit every orientation- and polarity-sensitive part on the board.

Written after the buck was found mirrored on both axes. The lesson there was that
eyeballing a render is not a check, so this reads the board and asserts.

Three passes:
  1. Groups of identical parts must agree pad-for-pad. If DMX1 pin 1 is GND, then DMX2 and
     DMX3 pin 1 had better be GND too.
  2. Polarised parts (electrolytic, diodes) get their pad-1 net reported explicitly.
  3. Multi-pin modules must all sit the same way round.

Read-only. Run:  python hardware-carrier/audit_polarity.py
"""
import collections
import os
import sys

import pcbnew

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

issues = []
notes = []


def pads(f):
    out = {}
    for p in f.Pads():
        try:
            out[int(p.GetNumber())] = p.GetNetname()
        except ValueError:
            out[p.GetNumber()] = p.GetNetname()
    return out


def main():
    board = pcbnew.LoadBoard(BOARD)
    fps = list(board.GetFootprints())

    # ---- 1. identical parts must agree pad-for-pad --------------------------------
    # Group by footprint id + pad count, but compare the NET ROLE per pad. Signals differ
    # per port (DMX1_A vs DMX2_A), so compare the role, not the literal net name.
    def role(n):
        for k in ("DMX1_", "DMX2_", "DMX3_"):
            if n.startswith(k):
                return "<port>" + n[len(k):]
        for i in range(1, 6):
            if n in (f"PIX{i}", f"PIX{i}_5V"):
                return "<pix>" + n[len(f"PIX{i}"):]
        return n

    groups = collections.defaultdict(list)
    for f in fps:
        # A/B diodes are the same part in DIFFERENT roles, so they must not be lumped
        # together -- otherwise the audit reports its own grouping as a fault.
        suffix = ""
        for p in f.Pads():
            n = p.GetNetname()
            if n.endswith("_A"): suffix = " (A-Seite)"
            if n.endswith("_B"): suffix = " (B-Seite)"
        key = (f.GetFPIDAsString().split(":")[-1], len(list(f.Pads())), f.GetValue() + suffix)
        groups[key].append(f)

    print("=" * 78)
    print("1. Gruppen identischer Bauteile: stimmen die Pads ueberein?")
    print("=" * 78)
    for (fp, npads, val), members in sorted(groups.items()):
        if len(members) < 2:
            continue
        sigs = {}
        for f in members:
            sig = tuple(role(v) for _, v in sorted(pads(f).items()))
            sigs.setdefault(sig, []).append(f.GetReference())
        if len(sigs) == 1:
            sig = next(iter(sigs))
            print(f"  OK   {val[:26]:28s} x{len(members)}  {' | '.join(sig)}")
        else:
            issues.append(f"{val}: {len(sigs)} verschiedene Pad-Belegungen")
            print(f"  FEHLER {val[:26]:28s} x{len(members)}")
            for sig, refs in sigs.items():
                print(f"          {', '.join(refs):24s} -> {' | '.join(sig)}")

    # ---- 2. polarised parts -------------------------------------------------------
    print()
    print("=" * 78)
    print("2. Polarisierte Bauteile: was liegt an Pad 1?")
    print("=" * 78)
    for f in sorted(fps, key=lambda f: f.GetValue()):
        fpid = f.GetFPIDAsString().lower()
        val = f.GetValue()
        p = pads(f)
        if "cp_radial" in fpid or "uf" in val.lower() and "cp_" in fpid:
            print(f"  Elko  {val:20s} Pad1(+)={p.get(1)}  Pad2(-)={p.get(2)}")
            if p.get(1) == "GND":
                issues.append(f"{val}: Pad 1 (plus) haengt an GND")
        elif fpid.startswith("d_"):
            # KiCad convention: pad 1 = cathode, pad 2 = anode, silk bar on pad 1
            print(f"  Diode {f.GetReference():12s} Pad1(Kathode)={p.get(1):12s} "
                  f"Pad2(Anode)={p.get(2)}")

    # ---- 2b. connector labels vs PHYSICAL pin order --------------------------------
    # Pad NUMBERS say nothing about which pin is on the left: a header at rot -90 has pin 1
    # on the right. Compare the label against the pads sorted by POSITION, not by number.
    print()
    print("=" * 78)
    print("2b. Steckerbeschriftung gegen tatsaechliche Pin-Reihenfolge (links->rechts)")
    print("=" * 78)
    def short(n):
        return (n.replace("I2C_", "").replace("+3V3", "3V3").replace("V_PIX", "V+")
                 .replace("_5V", "").replace("+5V", "5V"))
    for f in sorted(fps, key=lambda f: f.GetReference()):
        lbl = f.GetReference()
        if "/" not in lbl or len(list(f.Pads())) < 2:
            continue
        # Work out the axis from the pads, and the reading direction from the TEXT angle.
        # Sorting by x and falling back to y invents a direction for vertical headers.
        pl = list(f.Pads())
        xs = {round(pcbnew.ToMM(p.GetPosition().x), 2) for p in pl}
        vertical = len(xs) == 1
        key = ((lambda p: pcbnew.ToMM(p.GetPosition().y)) if vertical
               else (lambda p: pcbnew.ToMM(p.GetPosition().x)))
        ps = sorted(pl, key=key)
        # text rotated 90/270 on a vertical header reads bottom-to-top
        ang = f.Reference().GetTextAngleDegrees() % 360
        if vertical and ang in (90, 270):
            ps = list(reversed(ps))
        axis = ("unten->oben" if vertical and ang in (90, 270)
                else "oben->unten" if vertical else "links->rechts")
        actual = [short(p.GetNetname()) for p in ps]
        claimed = [t.strip() for t in lbl.split(":")[-1].split("/")]
        SYN = {"vcc": "v+", "data": "pix", "+": "3v3", "gnd": "gnd", "shld": "gnd"}
        def same(c, a):
            c, a = c.lower().strip(), a.lower().strip()
            c = SYN.get(c, c)
            return c in a or a in c or c.lstrip("io") in a
        ok = len(claimed) == len(actual) and all(same(c, a) for c, a in zip(claimed, actual))
        rev = len(claimed) == len(actual) and all(
            same(c, a) for c, a in zip(claimed, list(reversed(actual))))
        verdict = "OK  " if ok else ("UMGEKEHRT" if rev else "PRUEFEN")
        print(f"  {verdict:9s} {lbl[:30]:32s} rot={f.GetOrientationDegrees():5.0f}"
              f"  {axis:13s} {' / '.join(actual)}")
        if rev:
            issues.append(f"{lbl}: Beschriftung laeuft GENAU ANDERSHERUM als die Pins "
                          f"(real {axis}: {' / '.join(actual)})")
        elif not ok:
            notes.append(f"{lbl}: Silk {' / '.join(claimed)}, real {' / '.join(actual)}")

    # ---- 3. modules: same way round? ----------------------------------------------
    print()
    print("=" * 78)
    print("3. Module: Drehung und Seite")
    print("=" * 78)
    for f in sorted(fps, key=lambda f: f.GetReference()):
        if len(list(f.Pads())) < 6:
            continue
        print(f"  {f.GetReference()[:26]:28s} rot={f.GetOrientationDegrees():6.1f}  "
              f"{'BACK ' if f.IsFlipped() else 'front'}  {f.GetValue()[:24]}")

    # ---- 4. the buck, explicitly --------------------------------------------------
    print()
    print("=" * 78)
    print("4. Buck-Orientierung (Rueckansicht = Loetseite)")
    print("=" * 78)
    u7 = next((f for f in fps if f.GetValue().startswith("12-24V ->")), None)
    if u7:
        px = {int(p.GetNumber()): (pcbnew.ToMM(p.GetPosition().x),
                                   pcbnew.ToMM(p.GetPosition().y)) for p in u7.Pads()}
        vin_left = (-px[1][0]) < (-px[3][0])
        minus_top = px[1][1] < px[2][1]
        print(f"  VIN {'LINKS' if vin_left else 'RECHTS'}, "
              f"minus {'OBEN' if minus_top else 'UNTEN'}"
              f"   {'OK' if vin_left and minus_top else 'FEHLER'}")
        if not (vin_left and minus_top):
            issues.append("Buck: VIN/minus falsch herum")

    print()
    print("=" * 78)
    if issues:
        print(f"{len(issues)} PROBLEM(E):")
        for i in issues:
            print(f"   - {i}")
    else:
        print("keine Widersprueche gefunden")
    for n in notes:
        print(f"   Hinweis: {n}")
    return 1 if issues else 0


if __name__ == "__main__":
    sys.exit(main())
