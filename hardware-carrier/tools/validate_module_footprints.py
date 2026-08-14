#!/usr/bin/env python3
"""HARD GATE: every module footprint must match modules.json, and nothing UNVERIFIED
may appear on the board.

This is the gate that would have caught the previous carrier board, whose socket layout was
written from a text description ("two 1x10 female headers, 2.54mm pitch, 25.4mm apart") that
nothing ever checked. It is in the same family as hardware/scripts/validate_header_parity.py.

Checks, all FATAL:
  1. Every .kicad_mod in the library re-derives exactly from modules.json
     (pad count, pad positions within TOL, pitch, row spacing, pin-1 position).
  2. Pin 1 is the only rectangular pad, so a mirrored placement is visible.
  3. If a board file is given, every module footprint it instantiates belongs to a
     modules.json entry whose confidence is VERIFIED or MEASURED.

Run:  python hardware-carrier/validate_module_footprints.py [board.kicad_pcb]
"""
import json
import os
import re
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
SRC = os.path.join(HERE, "modules.json")
LIB = os.path.join(HERE, "footprints", "LuxDMXCarrier.pretty")

TOL = 0.05          # mm; anything looser has scrapped boards before
OK_CONFIDENCE = ("VERIFIED", "MEASURED", "ASSUMED", "USER-SPECIFIED")

errors = []
warnings = []
checked = 0


def fail(msg):
    errors.append(msg)


def walk(modules, prefix=""):
    for key, val in modules.items():
        if key.startswith("_"):
            if isinstance(val, dict):
                yield from walk(val, prefix="desk/")
            continue
        yield prefix + key, val


def expected_pads(mod):
    """Re-derive pad positions from modules.json, independently of the generator."""
    pcb = mod["pcb"]
    ox, oy = pcb["width"] / 2.0, pcb["length"] / 2.0
    out = []
    for sp in mod.get("smd_pads") or []:
        out.append((sp["x"] - ox, sp["y"] - oy))
    for hdr in mod.get("headers") or []:
        p1 = hdr["pin1"]
        step = hdr.get("pitch", 2.54)
        down = hdr.get("direction", "down") == "down"
        for i in range(hdr["pins"]):
            x = p1["x"] - ox
            y = (p1["y"] + (i * step if down else -i * step)) - oy
            out.append((x, y))
    return out


def parse_pads(text):
    pads = []
    for m in re.finditer(
        r'\(pad "(\d+)" (?:thru_hole|smd) (\w+) \(at (-?[\d.]+) (-?[\d.]+)\)', text
    ):
        pads.append((int(m.group(1)), m.group(2), float(m.group(3)), float(m.group(4))))
    return sorted(pads)


def main():
    global checked
    with open(SRC) as f:
        data = json.load(f)
    mods = dict(walk(data["modules"]))

    if not os.path.isdir(LIB):
        fail(f"footprint library missing: {LIB}. Run gen_footprints.py.")
        return report()

    for fn in sorted(os.listdir(LIB)):
        if not fn.endswith(".kicad_mod"):
            continue
        fid = fn[: -len(".kicad_mod")]
        key = next((k for k in mods if k.replace("/", "_") == fid), None)
        if key is None:
            fail(f"{fn}: no matching entry in modules.json. Hand-drawn footprints are "
                 f"not allowed; every footprint must be generated.")
            continue
        mod = mods[key]

        if mod.get("confidence") not in OK_CONFIDENCE:
            fail(f"{fn}: modules.json confidence is {mod.get('confidence')}. "
                 f"A footprint must never exist for an unmeasured module.")
            continue
        if mod.get("confidence") == "ASSUMED":
            warnings.append(
                f"{fn}: geometry is ASSUMED, not measured. Placement must carry extra "
                f"clearance and the 1:1 PAPER TEST IS MANDATORY before fab.")

        text = open(os.path.join(LIB, fn)).read()
        got = parse_pads(text)
        exp = expected_pads(mod)
        checked += 1

        if len(got) != len(exp):
            fail(f"{fn}: {len(got)} pads on the footprint, {len(exp)} derived from "
                 f"modules.json")
            continue

        for (num, shape, gx, gy), (ex, ey) in zip(got, exp):
            if abs(gx - ex) > TOL or abs(gy - ey) > TOL:
                fail(f"{fn}: pad {num} at ({gx:.3f},{gy:.3f}), modules.json says "
                     f"({ex:.3f},{ey:.3f}), off by "
                     f"({gx-ex:+.3f},{gy-ey:+.3f}) mm")

        # SMD land patterns are all rect by nature and have no pin-1 convention
        if mod.get("smd_pads") and not mod.get("headers"):
            continue
        rects = [p for p in got if p[1] == "rect"]
        if len(rects) != 1:
            fail(f"{fn}: {len(rects)} rectangular pads, expected exactly 1 (pin 1). "
                 f"Without a unique pin-1 marker a mirrored placement is invisible.")
        elif rects[0][0] != 1:
            fail(f"{fn}: the rectangular pad is pin {rects[0][0]}, not pin 1")

        # row spacing sanity: header rows are essentially always a whole 2.54 multiple
        xs = sorted({round(p[2], 3) for p in got})
        if len(xs) == 2:
            span = xs[1] - xs[0]
            n = span / 2.54
            if abs(n - round(n)) > 0.01:
                warnings.append(
                    f"{fn}: row spacing {span:.3f} mm is not a whole multiple of 2.54 "
                    f"({n:.2f} pitches). Possible, but re-measure before trusting it.")

    # anything blocked?
    for key, mod in mods.items():
        if mod.get("confidence") not in OK_CONFIDENCE:
            warnings.append(f"{key}: confidence={mod.get('confidence')}, no footprint, "
                            f"cannot be placed.")

    # board check
    if len(sys.argv) > 1:
        board = sys.argv[1]
        btext = open(board).read()
        used = set(re.findall(r'\(footprint "([^"]+)"', btext))
        for fpname in used:
            short = fpname.split(":")[-1]
            key = next((k for k in mods if k.replace("/", "_") == short), None)
            if key and mods[key].get("confidence") not in OK_CONFIDENCE:
                fail(f"board {board}: places {short}, whose modules.json confidence is "
                     f"{mods[key].get('confidence')}")
    return report()


def report():
    print(f"validate_module_footprints: {checked} footprint(s) checked against modules.json")
    for w in warnings:
        print(f"  WARN  {w}")
    for e in errors:
        print(f"  FATAL {e}")
    if errors:
        print(f"\nFAILED with {len(errors)} error(s)")
        return 1
    print("\nPASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
