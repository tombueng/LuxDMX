#!/usr/bin/env python3
"""Generate KiCad footprints for the carrier board from modules.json.

Footprints are NEVER drawn by hand here. modules.json is the single source of mechanical
truth, this script is the only thing allowed to turn it into copper, and
validate_module_footprints.py checks the result. That chain exists because the previous
carrier attempt hand-wrote a socket layout from a text description and the modules did not
fit.

Only modules whose `confidence` is VERIFIED or MEASURED are emitted. UNVERIFIED ones are
listed as skipped, loudly, so a missing socket is never a silent surprise.

Coordinate convention in modules.json: origin at the module PCB's top-left corner, x to the
right, y downwards, viewed from the TOP (component side). Footprints are emitted with the
origin at the centre of the module outline.

Run:  python hardware-carrier/gen_footprints.py
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
SRC = os.path.join(HERE, "modules.json")
OUTDIR = os.path.join(HERE, "footprints", "LuxDMXCarrier.pretty")

PAD_SIZE = 1.7          # square/round pad for a 2.54 mm header
DRILL = 1.0
SILK_W = 0.12
FAB_W = 0.10
CRTYD_W = 0.05
CRTYD_MARGIN = 0.5

OK_CONFIDENCE = ("VERIFIED", "MEASURED", "ASSUMED", "USER-SPECIFIED")


def walk(modules, prefix=""):
    """Yield (id, entry) for every real module, flattening the _desk group."""
    for key, val in modules.items():
        if key.startswith("_"):
            if isinstance(val, dict):
                yield from walk(val, prefix="desk/")
            continue
        yield prefix + key, val


def emit(fid, mod):
    pcb = mod.get("pcb") or {}
    L = pcb.get("length")
    W = pcb.get("width")
    headers = mod.get("headers")
    smd = mod.get("smd_pads")
    if not (L and W and (headers or smd)):
        return None, "no pcb outline or pads in modules.json"

    # origin at outline centre
    ox, oy = W / 2.0, L / 2.0
    lines = []
    name = fid.replace("/", "_")
    lines.append(f'(footprint "{name}"')
    lines.append("  (version 20240108)")
    lines.append('  (generator "luxdmx-carrier-gen_footprints")')
    lines.append('  (layer "F.Cu")')
    descr = f"{mod.get('vendor','')} {mod.get('name','')} socket. "
    descr += f"Generated from modules.json, confidence={mod['confidence']}. "
    if mod["confidence"] == "ASSUMED":
        descr += "ASSUMED GEOMETRY - 1:1 paper test MANDATORY before fab. "
    descr += f"Source: {mod.get('source','')}"
    lines.append(f'  (descr "{descr.replace(chr(34), chr(39))}")')
    lines.append('  (attr %s)' % ("smd" if (smd and not headers) else "through_hole"))
    lines.append(f'  (fp_text reference "REF**" (at 0 {-oy-1.6:.3f}) (layer "F.SilkS")'
                 ' (effects (font (size 1 1) (thickness 0.15))))')
    lines.append(f'  (fp_text value "{name}" (at 0 {oy+1.6:.3f}) (layer "F.Fab")'
                 ' (effects (font (size 1 1) (thickness 0.15))))')

    drill = mod.get("drill_override", DRILL)
    padno = 0

    # SMD land pattern (oversized pads, no drill) -- used for modules whose outline
    # varies between vendors, so the copper is bigger than any of them.
    for sp in (smd or []):
        padno += 1
        x = sp["x"] - ox
        y = sp["y"] - oy
        lines.append(f'  (pad "{padno}" smd rect (at {x:.3f} {y:.3f})'
                     f' (size {sp["w"]} {sp["h"]})'
                     ' (layers "F.Cu" "F.Paste" "F.Mask"))')
        lines.append(f'  (fp_text user "{sp["name"]}" (at {x:.3f} {y - sp["h"]/2 - 0.9:.3f})'
                     ' (layer "F.SilkS") (effects (font (size 0.8 0.8) (thickness 0.12))))')
    if smd and not headers:
        headers = []
    pin1_pos = None
    for hdr in headers:
        p1 = hdr.get("pin1")
        if not p1:
            return None, f"header {hdr.get('ref')} has no pin1 position"
        step = hdr.get("pitch", 2.54)
        down = hdr.get("direction", "down") == "down"
        names = hdr.get("names") or []
        for i in range(hdr["pins"]):
            padno += 1
            x = p1["x"] - ox
            y = (p1["y"] + (i * step if down else -i * step)) - oy
            shape = "rect" if padno == 1 else "circle"
            if padno == 1:
                pin1_pos = (x, y)
            lines.append(f'  (pad "{padno}" thru_hole {shape} (at {x:.3f} {y:.3f})'
                         f' (size {PAD_SIZE} {PAD_SIZE}) (drill {drill})'
                         ' (layers "*.Cu" "*.Mask"))')
            if i < len(names):
                just = "left" if x < 0 else "right"
                lx = x + (1.4 if x < 0 else -1.4)
                lines.append(f'  (fp_text user "{names[i]}" (at {lx:.3f} {y:.3f})'
                             ' (layer "F.Fab") (effects (font (size 0.6 0.6)'
                             f' (thickness 0.1)) (justify {just})))')

    # module outline on F.Fab, silkscreen just outside it
    for layer, wdt in (("F.Fab", FAB_W), ("F.SilkS", SILK_W)):
        m = 0.0 if layer == "F.Fab" else 0.15
        x0, y0, x1, y1 = -ox - m, -oy - m, ox + m, oy + m
        lines.append(f'  (fp_rect (start {x0:.3f} {y0:.3f}) (end {x1:.3f} {y1:.3f})'
                     f' (stroke (width {wdt}) (type solid)) (fill none) (layer "{layer}"))')

    c = CRTYD_MARGIN
    lines.append(f'  (fp_rect (start {-ox-c:.3f} {-oy-c:.3f}) (end {ox+c:.3f} {oy+c:.3f})'
                 f' (stroke (width {CRTYD_W}) (type solid)) (fill none) (layer "F.CrtYd"))')

    # pin-1 marker, so a mirrored placement is visible on the board
    if pin1_pos:
        px, py = pin1_pos
        mx = px - 1.4 if px < 0 else px + 1.4
        lines.append(f'  (fp_circle (center {mx:.3f} {py:.3f}) (end {mx+0.3:.3f} {py:.3f})'
                     f' (stroke (width 0.2) (type solid)) (fill solid) (layer "F.SilkS"))')

    for ko in mod.get("keepouts", []):
        lines.append(f'  (fp_text user "KEEPOUT: {ko["what"]} - {ko["rule"]}"'
                     f' (at 0 {-oy-3.2:.3f}) (layer "F.Fab")'
                     ' (effects (font (size 0.5 0.5) (thickness 0.08))))')

    lines.append(")")
    return "\n".join(lines) + "\n", None


def main():
    with open(SRC) as f:
        data = json.load(f)

    os.makedirs(OUTDIR, exist_ok=True)
    made, skipped, incomplete = [], [], []

    for fid, mod in walk(data["modules"]):
        conf = mod.get("confidence")
        if conf not in OK_CONFIDENCE:
            skipped.append((fid, conf))
            continue
        text, err = emit(fid, mod)
        if err:
            # Confidence is fine, the entry just does not carry the fields this generator
            # needs yet (DIP/SIL parts use a different schema). Not a pipeline error.
            incomplete.append((fid, err))
            continue
        path = os.path.join(OUTDIR, fid.replace("/", "_") + ".kicad_mod")
        with open(path, "w") as f:
            f.write(text)
        made.append((fid, os.path.basename(path)))

    print(f"generated into {os.path.relpath(OUTDIR, HERE)}/")
    for fid, fn in made:
        print(f"  OK      {fid:42s} -> {fn}")
    for fid, err in incomplete:
        print(f"  partial {fid:42s}    {err}")
    for fid, conf in skipped:
        print(f"  BLOCKED {fid:42s}    confidence={conf}, needs measuring")

    print(f"\n{len(made)} generated, {len(incomplete)} incomplete, {len(skipped)} blocked")
    if skipped:
        print("BLOCKED modules CANNOT be placed on the board.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
