#!/usr/bin/env python3
"""Put the regenerated regulator footprint on the routed board, and wire up its new holes.

2026-11-21: the 5 V regulator spot grew two 0.1 in rows (Pololu D24V10F5 and a 78xx-style SIP
on row A, Pololu D36V28F5 on row B) and the D36V28F5's two M2 holes, all inside the existing
envelope's gap between the right-hand lands. The four corner lands do not move, so whatever is
routed to them stays valid. This script:

  1. swaps the placed footprint for the library version. Refuses unless pads 1-4 land exactly
     where they were, the same check swap_footprint.py makes. Nets of the old pads carry over,
     the new pads get theirs from modules.json ("tht_pads"; null = no net).
  2. removes the two GND stitching vias the plated M2 holes replace (they sat 0.36 and 1.34 mm
     from the hole centres; a plated GND hole stitches F and B the same way).
  3. lays the two short connections the new rows need:
       VOUT (+5V): F.Cu, 1.0 mm, from the row-A/row-B VOUT holes down-left to a via inside the
                   +5V corner land. F.Cu because B.Cu is walled off by +3V3 and PIX5_5V.
       VIN (V_PIX): B.Cu, 0.8 mm, row-A VIN diagonally between SHDN and row-B GND to row-B VIN,
                   then straight into the V_PIX corner land.
     GND needs nothing: the holes sit in both GND pours and on the B.Cu GND track.
  4. refills the zones.

Each step runs in its own process (pcbnew segfaults on mixed remove/add in one interpreter).
Afterwards: python tools/mask_grid.py (the swap gives the corner lands their own mask back).

Run:  python tools/update_buck_footprint.py
"""
import json
import os
import re
import subprocess
import sys


def _project_dir():
    d = os.path.dirname(os.path.abspath(__file__))
    for _ in range(3):
        if os.path.exists(os.path.join(d, "luxdmx-carrier.kicad_pcb")):
            return d
        d = os.path.dirname(d)
    return os.path.dirname(os.path.abspath(__file__))


HERE = _project_dir()
BOARD = os.path.join(HERE, "luxdmx-carrier.kicad_pcb")
LIB = os.path.join(HERE, "footprints", "LuxDMXCarrier.pretty")
FPNAME = "buck-module-universal"
REF = "5V Buck Converter"
TOL = 0.01
REF_AT = (169.5, 110.35)        # board mm, between the lower corner lands' labels and the vias at y 112

# vias the M2 holes replace, board mm
VIAS_REPLACED = [(186.5, 100.0), (174.5, 84.0)]


def tht_nets():
    with open(os.path.join(HERE, "modules.json")) as f:
        m = json.load(f)["modules"][FPNAME]
    first = len(m.get("smd_pads", [])) + 1
    return {str(first + i): tp.get("net") for i, tp in enumerate(m.get("tht_pads", []))}


def find(b):
    import pcbnew
    fp = next((f for f in b.GetFootprints() if f.GetReference() == REF), None)
    if fp is None:
        raise SystemExit(f"{REF!r} not on the board")
    return fp


def pad_pos(fp, num):
    import pcbnew
    p = next(p for p in fp.Pads() if p.GetNumber() == num)
    q = p.GetPosition()
    return pcbnew.ToMM(q.x), pcbnew.ToMM(q.y)


def stage_swap():
    import pcbnew
    b = pcbnew.LoadBoard(BOARD)
    old = find(b)
    new = pcbnew.FootprintLoad(LIB, FPNAME)
    b.Add(new)          # Flip() on a footprint that belongs to no board segfaults in KiCad 10
    # side first, then angle: Flip() mirrors the angle, so setting it afterwards is exact
    if old.IsFlipped():
        new.Flip(new.GetPosition(), pcbnew.FLIP_DIRECTION_LEFT_RIGHT)
    new.SetOrientationDegrees(old.GetOrientationDegrees())
    new.SetPosition(old.GetPosition())
    oldpads = {p.GetNumber(): p for p in old.Pads()}
    for num, p in oldpads.items():
        a, c = pad_pos(old, num), pad_pos(new, num)
        if abs(a[0] - c[0]) > TOL or abs(a[1] - c[1]) > TOL:
            raise SystemExit(f"pad {num} moved {a} -> {c}, refusing")
    keep = dict(val=old.GetValue(), rtext=old.Reference().GetPosition() - old.GetPosition(),
                rangle=old.Reference().GetTextAngleDegrees(), rlayer=old.Reference().GetLayer(),
                rsize=old.Reference().GetTextSize(), rvis=old.Reference().IsVisible(),
                vvis=old.Value().IsVisible(), dnp=old.IsDNP(),
                nobom=old.IsExcludedFromBOM(), nopos=old.IsExcludedFromPosFiles(),
                models=[(m.m_Filename, m.m_Show) for m in old.Models()])
    nets = {n: p.GetNet() for n, p in oldpads.items()}
    b.Remove(old)
    new.SetReference(REF)
    new.SetValue(keep["val"])
    new.SetDNP(keep["dnp"])
    new.SetExcludedFromBOM(keep["nobom"])
    new.SetExcludedFromPosFiles(keep["nopos"])
    for fn, show in keep["models"]:
        m = pcbnew.FP_3DMODEL()
        m.m_Filename = fn
        m.m_Show = show
        new.Models().push_back(m)
    new.Value().SetVisible(keep["vvis"])
    r = new.Reference()
    # The reference used to sit in the middle of the land, which is where row A/B are now.
    # It moves into the strip below the lower lands, smaller so it fits between them.
    r.SetPosition(pcbnew.VECTOR2I(pcbnew.FromMM(REF_AT[0]), pcbnew.FromMM(REF_AT[1])))
    r.SetTextAngleDegrees(keep["rangle"])
    r.SetLayer(keep["rlayer"])
    r.SetTextSize(pcbnew.VECTOR2I(pcbnew.FromMM(0.8), pcbnew.FromMM(0.8)))
    r.SetTextThickness(pcbnew.FromMM(0.12))
    r.SetVisible(keep["rvis"])
    want = tht_nets()
    for p in new.Pads():
        n = p.GetNumber()
        if n in nets:
            p.SetNet(nets[n])
        elif n in want:
            if want[n]:
                ni = b.FindNet(want[n])
                if ni is None:
                    raise SystemExit(f"net {want[n]} not on the board")
                p.SetNet(ni)
            else:
                p.SetNetCode(0)
    pcbnew.SaveBoard(BOARD, b)
    print("\n@@RESULT %d pads" % len(list(new.Pads())), flush=True)


def stage_vias():
    import pcbnew
    b = pcbnew.LoadBoard(BOARD)
    gone = []
    for t in list(b.GetTracks()):
        if t.Type() != pcbnew.PCB_VIA_T or t.GetNetname() != "GND":
            continue
        q = t.GetPosition()
        x, y = pcbnew.ToMM(q.x), pcbnew.ToMM(q.y)
        if any(abs(x - vx) < 0.05 and abs(y - vy) < 0.05 for vx, vy in VIAS_REPLACED):
            b.Remove(t)
            gone.append((x, y))
    pcbnew.SaveBoard(BOARD, b)
    print("\n@@RESULT %s" % gone, flush=True)


def stage_tracks():
    import pcbnew
    b = pcbnew.LoadBoard(BOARD)
    fp = find(b)
    want = tht_nets()

    def pad(name, row):
        with open(os.path.join(HERE, "modules.json")) as f:
            m = json.load(f)["modules"][FPNAME]
        first = len(m.get("smd_pads", [])) + 1
        for i, tp in enumerate(m["tht_pads"]):
            if tp["name"] == name and tp.get("row") == row:
                return pad_pos(fp, str(first + i))
        raise SystemExit(f"no pad {name} {row}")

    def seg(a, c, w, layer, net):
        t = pcbnew.PCB_TRACK(b)
        t.SetStart(pcbnew.VECTOR2I(pcbnew.FromMM(a[0]), pcbnew.FromMM(a[1])))
        t.SetEnd(pcbnew.VECTOR2I(pcbnew.FromMM(c[0]), pcbnew.FromMM(c[1])))
        t.SetWidth(pcbnew.FromMM(w))
        t.SetLayer(layer)
        t.SetNet(b.FindNet(net))
        b.Add(t)

    for t in b.GetTracks():         # idempotent: a second run must not double the copper
        if t.Type() == pcbnew.PCB_VIA_T and t.GetNetname() == "+5V":
            q = t.GetPosition()
            land = pad_pos(fp, "4")
            if abs(pcbnew.ToMM(q.x) - (land[0] + 5.1)) < 0.05:
                print("\n@@RESULT already there", flush=True)
                return
    vout_a, vout_b = pad("VOUT", "A"), pad("VOUT", "B")
    vin_a, vin_b = pad("VIN", "A"), pad("VIN", "B")
    land_5v = pad_pos(fp, "4")      # +5V corner land
    land_vin = pad_pos(fp, "2")     # V_PIX corner land

    # +5V: A -> B, then 45 degrees down-left until level with a point inside the +5V land,
    # then straight left to a via 0.9 mm in from the land's inner end.
    via_x = land_5v[0] + 6.0 - 0.9           # land is 12 mm long, centred on its pad position
    via_y = vout_b[1] + 3.97
    seg(vout_a, vout_b, 1.0, pcbnew.F_Cu, "+5V")
    knee = (vout_b[0] - (via_y - vout_b[1]), via_y)
    seg(vout_b, knee, 1.0, pcbnew.F_Cu, "+5V")
    seg(knee, (via_x, via_y), 1.0, pcbnew.F_Cu, "+5V")
    v = pcbnew.PCB_VIA(b)
    v.SetViaType(pcbnew.VIATYPE_THROUGH)
    v.SetLayerPair(pcbnew.F_Cu, pcbnew.B_Cu)
    v.SetPosition(pcbnew.VECTOR2I(pcbnew.FromMM(via_x), pcbnew.FromMM(via_y)))
    v.SetWidth(pcbnew.FromMM(0.8))
    v.SetDrill(pcbnew.FromMM(0.4))
    v.SetNet(b.FindNet("+5V"))
    b.Add(v)

    # V_PIX: A -> B diagonally, then down into the land (its top edge is 2.5 mm above centre).
    seg(vin_a, vin_b, 0.8, pcbnew.B_Cu, "V_PIX")
    seg(vin_b, (vin_b[0], land_vin[1] - 1.5), 0.8, pcbnew.B_Cu, "V_PIX")
    pcbnew.SaveBoard(BOARD, b)
    print("\n@@RESULT via %.2f,%.2f knee %.2f,%.2f" % (via_x, via_y, *knee), flush=True)


def stage_fill():
    import pcbnew
    b = pcbnew.LoadBoard(BOARD)
    pcbnew.ZONE_FILLER(b).Fill(b.Zones())
    pcbnew.SaveBoard(BOARD, b)
    print("\n@@RESULT filled", flush=True)


def sub(name):
    r = subprocess.run([sys.executable, os.path.abspath(__file__), "--stage", name],
                       capture_output=True, text=True)
    m = re.search(r"@@RESULT ([^\n]*)", r.stdout)
    if not m:
        raise SystemExit(f"stage {name} failed:\n{r.stdout[-900:]}\n{r.stderr[-900:]}")
    return m.group(1)


def main():
    if "--stage" in sys.argv:
        return {"swap": stage_swap, "vias": stage_vias, "tracks": stage_tracks,
                "fill": stage_fill}[sys.argv[sys.argv.index("--stage") + 1]]()
    for s in ("swap", "vias", "tracks", "fill"):
        print(f"{s:7s} {sub(s)}")
    print("now run: python tools/mask_grid.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
