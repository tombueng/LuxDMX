"""Regenerate the inner GND planes + isolated pours from the LIVE part positions --
no hardcoded coordinates. Generalised for the multi-domain v3.1:

  * inner layers (In1/In2): ONE GND plane per layer, the full board rectangle with a
    POLYGON HOLE carved around each isolated/hot domain (so no inner copper crosses any
    barrier). Holes are used -- NOT keepout rule-areas -- because Freerouting 2.x chokes
    on rule-areas (runaway PolylineTrace.normalize on power nets) but handles holed planes
    fine, exactly like the original single-universe U-notch did.
  * F+B: a dedicated pour for each DMX domain's isolated ground (GNDISO, GNDISO2).
  * the PoE-hot domain (VPOE+/-) gets an inner-plane hole only (its 1.5 kV isolation from
    board GND must hold vertically too); no F/B ground pour.

Domains are data-driven; each domain's pad bbox (+ its creepage margin) drives the hole.
Run after placing, then escape_connectors -> autoroute_fr2 -> cleanup_pads. KiCad 10 python."""
import pcbnew, math

PCB = r"C:\dev\DMX\hardware\lumigate.kicad_pcb"
FM = pcbnew.FromMM; TM = pcbnew.ToMM

# name -> (set of nets, F/B pour net or None, creepage margin mm)
# NB: PoE is deliberately NOT pre-voided here. Its VPOE+/- (isolated 48V) runs from the magjack
# to the PD module and a bbox void around that span would swallow the inner GND plane under the
# W5500 (bad Ethernet return paths + leaves U2 GND unroutable). Instead the inner plane stays
# SOLID during routing (so GND connects everywhere) and tighten_poe_void.py carves a tight moat
# hugging only the actual routed VPOE copper afterwards. DMX islands are compact, so bbox is fine.
DOMAINS = [
    ("DMX1", {"GNDISO", "VISO", "VISO_DRV", "DMX_A", "DMX_B", "DMX_AO", "DMX_BO", "DMX_A_TERM"}, "GNDISO", 4.0),
    ("DMX2", {"GNDISO2", "VISO2", "VISO2_DRV", "DMX2_A", "DMX2_B", "DMX2_AO", "DMX2_BO"}, "GNDISO2", 4.0),
]

b = pcbnew.LoadBoard(PCB)


def pad_bbox(nets):
    xs = []; ys = []
    for fp in b.GetFootprints():
        for p in fp.Pads():
            if p.GetNetname() in nets:
                r = p.GetBoundingBox()
                xs += [TM(r.GetLeft()), TM(r.GetRight())]
                ys += [TM(r.GetTop()), TM(r.GetBottom())]
    return (min(xs), max(xs), min(ys), max(ys)) if xs else None


def add_rect(polyset, x0, y0, x1, y1, hole_of=None):
    if hole_of is None:
        polyset.NewOutline()
        for x, y in [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]:
            polyset.Append(FM(x), FM(y))
    else:
        polyset.NewHole()
        h = polyset.HoleCount(0) - 1
        for x, y in [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]:
            polyset.Append(FM(x), FM(y), 0, h)


def fb_pour(net_name, x0, y0, x1, y1):
    net = b.FindNet(net_name)
    if net is None:
        print(f"  WARNING net {net_name} not found -- no pour"); return
    z = pcbnew.ZONE(b)
    ls = pcbnew.LSET(); ls.AddLayer(pcbnew.F_Cu); ls.AddLayer(pcbnew.B_Cu)
    z.SetLayerSet(ls); z.SetNetCode(net.GetNetCode()); z.SetAssignedPriority(1)
    z.SetPadConnection(pcbnew.ZONE_CONNECTION_FULL)            # solid pad/via connection (no starved thermals on the iso ground)
    z.SetIslandRemovalMode(pcbnew.ISLAND_REMOVAL_MODE_ALWAYS)   # drop orphan fill slivers
    z.Outline().RemoveAllContours()
    add_rect(z.Outline(), x0, y0, x1, y1)
    b.Add(z)
    print(f"  {net_name} F+B pour x {x0:.1f}..{x1:.1f}")


# wipe old zones + tracks (full re-route follows). Gather BOTH lists BEFORE removing
# anything -- removing zones first corrupts the track SWIG iterator (GetTracks throws).
old_zones = list(b.Zones())
old_tracks = list(b.GetTracks())
for z in old_zones:
    b.Remove(z)
for t in old_tracks:
    b.Remove(t)

b.SetCopperLayerCount(4)
# In1/In2 are GND/+3V3 PLANES, not signal layers -- mark them POWER so Freerouting keeps them solid
# and routes signals only on F.Cu/B.Cu (clean 4-layer stackup: F sig / GND / +3V3 / B sig).
b.SetLayerType(pcbnew.In1_Cu, pcbnew.LT_POWER)
b.SetLayerType(pcbnew.In2_Cu, pcbnew.LT_POWER)
gnd = b.FindNet("GND")

bb = b.GetBoardEdgesBoundingBox()
BX0, BY0 = TM(bb.GetLeft()) + 0.2, TM(bb.GetTop()) + 0.2
BX1, BY1 = TM(bb.GetRight()) - 0.2, TM(bb.GetBottom()) - 0.2

# collect holes (one per domain) + drop F/B pours for the DMX domains
holes = []
for name, nets, pour, crp in DOMAINS:
    bx = pad_bbox(nets)
    if not bx:
        print(f"  {name}: no pads placed yet -- skipped"); continue
    x0, x1, y0, y1 = bx
    holes.append((x0 - crp, y0 - crp, x1 + crp, y1 + crp))
    print(f"  {name}: inner-GND hole x {x0-crp:.1f}..{x1+crp:.1f} y {y0-crp:.1f}..{y1+crp:.1f}")
    if pour:
        fb_pour(pour, x0 - 0.4, y0 - 0.4, x1 + 0.6, y1 + 0.6)

# inner planes: In1 = GND, In2 = +3V3 (power plane). Both = full board rect minus the iso domain
# holes (VISO must not touch the +3V3 plane, GNDISO must not touch GND). The +3V3 plane turns every
# +3V3 pad into a short via-to-plane instead of a routed net AND gives F/B signals a solid reference.
# GND plane uses ALWAYS island-removal (it has many TH connections); the +3V3 plane uses NONE so it
# survives the fill before the autorouter vias the (mostly SMD) +3V3 pads into it.
p3v3 = b.FindNet("+3V3")
for ly, net, rm in ((pcbnew.In1_Cu, gnd, pcbnew.ISLAND_REMOVAL_MODE_ALWAYS),
                    (pcbnew.In2_Cu, p3v3, pcbnew.ISLAND_REMOVAL_MODE_ALWAYS)):
    z = pcbnew.ZONE(b); z.SetLayer(ly); z.SetNetCode(net.GetNetCode())
    z.SetAssignedPriority(0); z.SetPadConnection(pcbnew.ZONE_CONNECTION_FULL)
    z.SetIslandRemovalMode(rm)
    ps = z.Outline(); ps.RemoveAllContours()
    add_rect(ps, BX0, BY0, BX1, BY1)
    for (hx0, hy0, hx1, hy1) in holes:
        add_rect(ps, hx0, hy0, hx1, hy1, hole_of=0)
    b.Add(z)
print(f"inner planes: In1=GND, In2=+3V3, {len(holes)} iso holes each")

# Auto-stitch each DMX domain's isolated ground: a LOCKED via-in-pad on every GNDISO/GNDISO2
# SMD pad. Those pads sit inside the iso region where the inner GND plane is voided, so the
# through-via can't short to GND -- it just ties the pad straight to the continuous B-pour, even
# when the F-pour gets split by the DMX traces. Locked => survives escape + autoroute clearing.
for pour_net in ("GNDISO", "GNDISO2"):
    net = b.FindNet(pour_net)
    if net is None:
        continue
    n = 0
    for fp in b.GetFootprints():
        for p in fp.Pads():
            if p.GetNetname() == pour_net and not p.HasHole():   # SMD pad on the iso ground
                pos = p.GetPosition()
                v = pcbnew.PCB_VIA(b); v.SetPosition(pcbnew.VECTOR2I(pos.x, pos.y))
                v.SetViaType(pcbnew.VIATYPE_THROUGH); v.SetDrill(FM(0.3)); v.SetWidth(FM(0.6))
                v.SetNetCode(net.GetNetCode()); v.SetLayerPair(pcbnew.F_Cu, pcbnew.B_Cu)
                v.SetLocked(True); b.Add(v); n += 1
    print(f"  stitch {pour_net}: {n} locked via-in-pad")

# Stitch the logic power pads straight to their inner planes: GND SMD pad -> In1 (GND), +3V3 SMD pad
# -> In2 (+3V3). A locked via-in-pad ties every power pad down so power needs NO routing and the
# planes stay solid under ISLAND_REMOVAL_ALWAYS. (Via-in-pad on decoupling = low inductance; request
# resin-filled/capped vias at fab, or accept minor wicking.) Skip pads inside an iso void (no plane).
def _in_hole(x, y):
    return any(hx0 <= x <= hx1 and hy0 <= y <= hy1 for (hx0, hy0, hx1, hy1) in holes)
for plane_net in ("GND", "+3V3"):
    net = b.FindNet(plane_net)
    if net is None:
        continue
    n = 0
    for fp in b.GetFootprints():
        fppads = list(fp.Pads())
        for p in fppads:
            if p.GetNetname() == plane_net and not p.HasHole():
                pos = p.GetPosition()
                if _in_hole(TM(pos.x), TM(pos.y)):
                    continue
                # skip FINE-PITCH pads (e.g. the W5500 QFN at 0.5mm): a 0.6mm via-in-pad would
                # collide with the neighbouring pad/via. Those power pins get fanned out to the
                # plane by the autorouter instead. Only stitch pads with room (caps, wide-pitch ICs).
                others = [q.GetPosition() for q in fppads if q.GetNumber() != p.GetNumber()]
                nn = min((math.hypot(TM(pos.x-o.x), TM(pos.y-o.y)) for o in others), default=9.0)
                if nn < 0.9:
                    continue
                v = pcbnew.PCB_VIA(b); v.SetPosition(pcbnew.VECTOR2I(pos.x, pos.y))
                v.SetViaType(pcbnew.VIATYPE_THROUGH); v.SetDrill(FM(0.3)); v.SetWidth(FM(0.6))
                v.SetNetCode(net.GetNetCode()); v.SetLayerPair(pcbnew.F_Cu, pcbnew.B_Cu)
                v.SetLocked(True); b.Add(v); n += 1
    print(f"  stitch {plane_net}: {n} locked via-in-pad to plane (fine-pitch pads left for the router)")

pcbnew.SaveBoard(PCB, b)
print("rebuilt + saved")
