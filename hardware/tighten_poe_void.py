"""POST-ROUTE: carve a TIGHT inner-plane isolation moat around the actual routed PoE-hot copper.

The PoE PD input (VPOE+/VPOE-, the rectified 37-57V tapped from the magjack centre-taps) is on the
ISOLATED side of the DP9900M module: it must keep the module's 1500 V isolation from board GND, so
the inner GND planes must NOT pass within the isolation distance under/around that copper. A naive
bounding-box void spanning magjack->module deletes the ground plane under the W5500. Instead we void
ONLY the real VPOE copper (tracks + pads + vias) inflated by POE_MARGIN, leaving the plane solid
(and the W5500 return path intact) everywhere else.

Regenerates the In1/In2 GND planes = board rect - DMX iso bbox holes - tight VPOE polygon, then
refills every zone. Run AFTER autoroute_fr2 + cleanup_pads (it needs the routed VPOE tracks).
Re-runnable / idempotent. KiCad 10 python."""
import pcbnew

PCB = r"C:\dev\DMX\hardware\luxdmx.kicad_pcb"
FM = pcbnew.FromMM
POE_MARGIN = 2.5     # mm, isolation around the 48 V PD-side copper
DMX = [("DMX1", {"GNDISO", "VISO", "DMX_A", "DMX_B", "DMX_A_TERM"}, 4.0),
       ("DMX2", {"GNDISO2", "VISO2", "DMX2_A", "DMX2_B"}, 4.0)]
POE_NETS = ("VPOE+", "VPOE-")
ERR = FM(0.01)

b = pcbnew.LoadBoard(PCB)
gnd = b.FindNet("GND")


def pad_bbox(nets):
    xs = []; ys = []
    for fp in b.GetFootprints():
        for p in fp.Pads():
            if p.GetNetname() in nets:
                r = p.GetBoundingBox(); xs += [r.GetLeft(), r.GetRight()]; ys += [r.GetTop(), r.GetBottom()]
    return (min(xs), max(xs), min(ys), max(ys)) if xs else None


# ---- moat ONLY around the VPOE through-hole pads (the magjack PoE pins), which are coplanar with
#      the inner GND plane yet sit inside J3's DRU-exempt courtyard so the fill would otherwise give
#      them only the default ~0.25mm anti-pad. Open VPOE vias are already cleared 2.5mm by the DRU;
#      surface F.Cu traces sit 0.2mm ABOVE the plane (vertical FR4 holds the 58V D10-clamped working
#      voltage with huge margin). Voiding only these 2 pins keeps the plane solid (W5500 return path
#      intact) and cannot fragment it. ----
poe = pcbnew.SHAPE_POLY_SET()
n_pad = 0
for fp in b.GetFootprints():
    for p in fp.Pads():
        if p.GetNetname() in POE_NETS and p.HasHole():     # TH PoE pin: coplanar with inner plane
            p.TransformShapeToPolygon(poe, pcbnew.F_Cu, FM(POE_MARGIN), ERR, pcbnew.ERROR_OUTSIDE); n_pad += 1
poe.Simplify()
print(f"VPOE TH-pin moat: {n_pad} pads -> {poe.OutlineCount()} moat outline(s)")

# ---- DMX bbox holes (same as rebuild_iso) ----
dmx_holes = []
for name, nets, crp in DMX:
    bx = pad_bbox(nets)
    if bx:
        x0, x1, y0, y1 = bx
        dmx_holes.append((x0 - FM(crp), y0 - FM(crp), x1 + FM(crp), y1 + FM(crp)))

bb = b.GetBoardEdgesBoundingBox()
BX0, BY0 = bb.GetLeft() + FM(0.2), bb.GetTop() + FM(0.2)
BX1, BY1 = bb.GetRight() - FM(0.2), bb.GetBottom() - FM(0.2)


def fill_plane(ps):                                        # modify the zone's polyset IN PLACE
    ps.RemoveAllContours()
    ps.NewOutline()
    for x, y in [(BX0, BY0), (BX1, BY0), (BX1, BY1), (BX0, BY1)]:
        ps.Append(int(x), int(y))
    for (hx0, hy0, hx1, hy1) in dmx_holes:                 # rectangular DMX holes
        ps.NewHole(); h = ps.HoleCount(0) - 1
        for x, y in [(hx0, hy0), (hx1, hy0), (hx1, hy1), (hx0, hy1)]:
            ps.Append(int(x), int(y), 0, h)
    for o in range(poe.OutlineCount()):                    # tight VPOE polygon hole(s)
        oc = poe.Outline(o)
        ps.NewHole(); h = ps.HoleCount(0) - 1
        for i in range(oc.PointCount()):
            pt = oc.CPoint(i); ps.Append(int(pt.x), int(pt.y), 0, h)


# ---- rebuild the In1/In2 GND plane outlines in place ----
n_zones = 0
for z in b.Zones():
    if z.GetLayer() in (pcbnew.In1_Cu, pcbnew.In2_Cu):     # both inner planes (In1=GND, In2=+3V3)
        fill_plane(z.Outline())
        n_zones += 1
print(f"rebuilt {n_zones} inner GND plane(s): board rect - {len(dmx_holes)} DMX holes - tight VPOE moat")

# refill everything
pcbnew.ZONE_FILLER(b).Fill(b.Zones())
b.BuildConnectivity()
pcbnew.SaveBoard(PCB, b)
print("PoE TH-pin moat carved + refilled + saved")
