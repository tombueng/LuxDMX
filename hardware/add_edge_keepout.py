import pcbnew
PCB = r"C:\dev\DMX\hardware\lumigate_carrier.kicad_pcb"
KO = 1.0  # mm edge keepout for tracks/vias
b = pcbnew.LoadBoard(PCB)
fm = pcbnew.FromMM; mm = pcbnew.ToMM

ec = [s for s in b.GetDrawings() if s.GetLayer() == pcbnew.Edge_Cuts][0].GetBoundingBox()
x1, y1, x2, y2 = mm(ec.GetLeft()), mm(ec.GetTop()), mm(ec.GetRight()), mm(ec.GetBottom())

# remove any previous edge-keepout rule areas (tagged via name)
for z in list(b.Zones()):
    if z.GetIsRuleArea() and z.GetZoneName() == "EDGE_KO":
        b.Remove(z)

ls = pcbnew.LSET()
ls.AddLayer(pcbnew.F_Cu); ls.AddLayer(pcbnew.B_Cu)

def keepout(xa, ya, xb, yb):
    z = pcbnew.ZONE(b)
    z.SetIsRuleArea(True)
    z.SetZoneName("EDGE_KO")
    z.SetLayerSet(ls)
    z.SetDoNotAllowTracks(True)
    z.SetDoNotAllowVias(True)
    z.SetDoNotAllowZoneFills(False)    # allow ground pour to fill -> edge GND/shield pads stay connected
    z.SetDoNotAllowPads(False)
    chain = pcbnew.SHAPE_LINE_CHAIN()
    for x, y in [(xa, ya), (xb, ya), (xb, yb), (xa, yb)]:
        chain.Append(fm(x), fm(y))
    chain.SetClosed(True)
    z.AddPolygon(chain)
    b.Add(z)

keepout(x1, y1, x2, y1 + KO)        # top
keepout(x1, y2 - KO, x2, y2)        # bottom
keepout(x1, y1, x1 + KO, y2)        # left
keepout(x2 - KO, y1, x2, y2)        # right

b.GetDesignSettings().m_CopperEdgeClearance = fm(KO)
for t in list(b.GetTracks()):
    b.Remove(t)
pcbnew.SaveBoard(PCB, b)
print(f"4 edge keepouts ({KO}mm, tracks/vias blocked, pour allowed), edge clearance {KO}mm, tracks cleared")
