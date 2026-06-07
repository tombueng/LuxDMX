import pcbnew, os
PCB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "lumigate_carrier.kicad_pcb")
b = pcbnew.LoadBoard(PCB)
mm = pcbnew.ToMM; fm = pcbnew.FromMM

codes = {}
for fp in b.GetFootprints():
    for p in fp.Pads():
        nm = p.GetNetname()
        if nm:
            codes[nm] = p.GetNetCode()

jp1 = b.FindFootprintByReference("JP1")
if jp1:
    b.Remove(jp1)

r1 = b.FindFootprintByReference("R1")
for pad in r1.Pads():
    if pad.GetNumber() == "2":
        pad.SetNetCode(codes["DMX_B"])

j1 = b.FindFootprintByReference("J1")
m = j1.Models()
while len(m) > 0:
    m.pop()
md = pcbnew.FP_3DMODEL()
md.m_Filename = "${KIPRJMOD}/3d/XLR3_NC3FBH.step"
md.m_Offset = pcbnew.VECTOR3D(0, 0, 1.6)
md.m_Rotation = pcbnew.VECTOR3D(0, 0, 0)
md.m_Scale = pcbnew.VECTOR3D(1, 1, 1)
m.push_back(md)

for t in list(b.GetTracks()):
    b.Remove(t)

u1x = mm(b.FindFootprintByReference("U1").GetPosition().x)
ucy = mm(b.FindFootprintByReference("U2").GetPosition().y)
ys = [mm(p.GetPosition().y) for fp in b.GetFootprints() for p in fp.Pads()]
W = 28.25
x1, x2 = u1x - W / 2, u1x + W / 2
y1, y2 = min(ys) - 2, max(ys) + 2

for s in [s for s in b.GetDrawings() if s.GetLayer() == pcbnew.Edge_Cuts]:
    b.Remove(s)
r = pcbnew.PCB_SHAPE(b)
r.SetShape(pcbnew.SHAPE_T_RECT)
r.SetStart(pcbnew.VECTOR2I(fm(x1), fm(y1)))
r.SetEnd(pcbnew.VECTOR2I(fm(x2), fm(y2)))
r.SetLayer(pcbnew.Edge_Cuts)
r.SetWidth(fm(0.15))
b.Add(r)

for z in list(b.Zones()):
    b.Remove(z)


def zone(net, ya, yb):
    for layer in (pcbnew.F_Cu, pcbnew.B_Cu):
        z = pcbnew.ZONE(b)
        z.SetLayer(layer)
        z.SetNetCode(codes[net])
        chain = pcbnew.SHAPE_LINE_CHAIN()
        for x, y in [(x1 + 0.5, ya), (x2 - 0.5, ya), (x2 - 0.5, yb), (x1 + 0.5, yb)]:
            chain.Append(fm(x), fm(y))
        chain.SetClosed(True)
        z.AddPolygon(chain)
        b.Add(z)


zone("GND", y1 + 0.5, ucy - 2.5)
zone("GNDISO", ucy + 2.5, y2 - 0.5)
pcbnew.SaveBoard(PCB, b)
print(f"saved: {x2-x1:.1f}x{y2-y1:.1f}mm, gap y={ucy:.1f}, JP1 removed, XLR 3D attached")
