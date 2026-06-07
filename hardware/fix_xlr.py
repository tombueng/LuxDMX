import pcbnew, os
PCB = r"C:\dev\DMX\hardware\lumigate_carrier.kicad_pcb"
LIB = r"C:\dev\DMX\hardware\easyeda\XLR328P.pretty"
b = pcbnew.LoadBoard(PCB)
mm = pcbnew.ToMM

codes = {}
for fp in b.GetFootprints():
    for p in fp.Pads():
        if p.GetNetname():
            codes[p.GetNetname()] = p.GetNetCode()

old = b.FindFootprintByReference("J1")
pos = old.GetPosition()
rot = old.GetOrientationDegrees()
b.Remove(old)

new = pcbnew.FootprintLoad(LIB, "CONN-TH_XLR-328P")
new.SetReference("J1")
new.SetValue("XLR-3 DMX out (XLR-328P)")
new.SetPosition(pos)
new.SetOrientationDegrees(rot)

# nets: pad1=shield->GNDISO, pad2=Data- ->DMX_B, pad3=Data+ ->DMX_A, mounting->GNDISO
netmap = {"1": "GNDISO", "2": "DMX_B", "3": "DMX_A"}
for pad in new.Pads():
    n = pad.GetNumber()
    name = netmap.get(n, "GNDISO" if n == "" else None)
    if name and name in codes:
        pad.SetNetCode(codes[name])

# real 3D model (STEP) at footprint origin
m = new.Models()
while len(m) > 0:
    m.pop()
md = pcbnew.FP_3DMODEL()
md.m_Filename = "${KIPRJMOD}/3d/XLR-328P.step"
md.m_Offset = pcbnew.VECTOR3D(0, 0, 0)
md.m_Rotation = pcbnew.VECTOR3D(0, 0, 0)
md.m_Scale = pcbnew.VECTOR3D(1, 1, 1)
m.push_back(md)

b.Add(new)
for t in list(b.GetTracks()):
    b.Remove(t)
pcbnew.SaveBoard(PCB, b)

j = b.FindFootprintByReference("J1")
print("J1 ->", "CONN-TH_XLR-328P at", round(mm(pos.x), 1), round(mm(pos.y), 1), "rot", rot)
for pad in j.Pads():
    print(f"  pad {pad.GetNumber()!r}: {pad.GetNetname()!r}")
