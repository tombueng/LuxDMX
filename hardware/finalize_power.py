"""Close the few GND/+3V3 power stubs the autorouter left open (it routed the pad out to a track but
didn't drop the final via into the plane). For each unconnected endpoint, tap the plane with a via at
the open track end -- skipping any spot within 0.5mm of an existing hole (JLCPCB hole-to-hole min) so
we don't create co-located/hole-clearance errors. With In1/In2 now solid POWER planes there are no
inner-layer signals to short against. Reads C:/tmp/drcU.json (regenerate DRC first if board changed).
KiCad 10 python."""
import pcbnew, json, re, math
PCB = r"C:\dev\DMX\hardware\lumigate.kicad_pcb"
FM, TM = pcbnew.FromMM, pcbnew.ToMM
b = pcbnew.LoadBoard(PCB)
d = json.load(open(r"C:\tmp\drcU.json"))

# existing hole positions (vias + TH pads)
holes = []
for t in b.GetTracks():
    if isinstance(t, pcbnew.PCB_VIA):
        p = t.GetPosition(); holes.append((TM(p.x), TM(p.y)))
for f in b.GetFootprints():
    for pd in f.Pads():
        if pd.HasHole():
            p = pd.GetPosition(); holes.append((TM(p.x), TM(p.y)))

def via(x, y, net):
    if any(math.hypot(x-hx, y-hy) < 0.5 for hx, hy in holes):
        return False
    v = pcbnew.PCB_VIA(b); v.SetPosition(pcbnew.VECTOR2I(FM(x), FM(y)))
    v.SetViaType(pcbnew.VIATYPE_THROUGH); v.SetDrill(FM(0.3)); v.SetWidth(FM(0.6))
    v.SetNetCode(b.FindNet(net).GetNetCode()); v.SetLayerPair(pcbnew.F_Cu, pcbnew.B_Cu)
    v.SetLocked(True); b.Add(v); holes.append((x, y)); return True

placed = skipped = 0
for u in d.get("unconnected_items", []):
    its = u["items"]
    m = re.search(r"\[([^\]]+)\]", its[0]["description"]); net = m.group(1) if m else None
    if net not in ("GND", "+3V3"): continue
    for it in its:
        if "Via" in it["description"]:
            continue
        if via(it["pos"]["x"], it["pos"]["y"], net): placed += 1
        else: skipped += 1

pcbnew.ZONE_FILLER(b).Fill(b.Zones())
b.BuildConnectivity()
pcbnew.SaveBoard(PCB, b)
print(f"tapped {placed} stub ends to plane ({skipped} skipped near a hole); unrouted now: {b.GetConnectivity().GetUnconnectedCount(True)}")
