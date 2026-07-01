"""Deterministic 2-layer maze-router for the 8 TBU DMX-data nets (Freerouting 2.x NPE-crashes on this
locked board). Dijkstra over (cell, layer) with a high via penalty -> prefers F.Cu, drops a B.Cu via only
where a net must cross another (e.g. DMX_BX reaching the far XLR pin). Obstacles = every other-net copper
inflated by clearance, and EACH routed net is added to the obstacle grids before the next routes (so the 8
new nets never cross each other). Re-runnable: deletes any existing tracks on the 8 nets first. KiCad 10."""
import pcbnew, math, heapq
PCB = r"C:\dev\DMX\hardware\luxdmx.kicad_pcb"
FM, TM = pcbnew.FromMM, pcbnew.ToMM
b = pcbnew.LoadBoard(PCB)

# Route by IMPORTANCE, in order: sensitive HS/analog -> W5500 control -> USB/serial -> DMX -> display/LED
# -> trivial expansion/straps; shortest span first within a tier. Already-routed (locked cluster) nets are
# kept as obstacles and NOT re-routed. Computed from the board so nothing is forgotten.
from collections import defaultdict as _dd
_PLANE = {"GND","+3V3","GNDISO","GNDISO2"}   # true inner planes + iso pours ONLY; the +5V family, VISO*, VPOE* are normal nets -> route them
def _prio(n):
    if n in ("USB_DM","+5V_USB","EXP_IO37","IO0"): return 2.5  # boxed-in "last nets": route right after the
                                                               # critical cluster (board still open) so they
                                                               # don't get walled in by the bulk -> then fit
    if n.startswith("EXP_") or n in ("EN","IO0"): return 6
    if n.startswith("DISP_") or n.startswith("LED_") or n in ("ETH_ACTLED","ETH_LINKLED","N$2") or n.startswith("+5V_USB"): return 5
    if n.startswith("DMX"): return 4
    if n.startswith("USB_") or n in ("S3_TX","S3_RX","CC1","RTS","DTR"): return 3
    if n in ("SCLK","MOSI","MISO","ETH_CS","ETH_INT","ETH_RST"): return 2
    return 1   # eth diff pairs, center taps, VISO_DRV(2), BUCK_FB -> most sensitive
_rnets = set(t.GetNetname() for t in b.GetTracks() if t.Type() == pcbnew.PCB_TRACE_T)
_np = _dd(list)
for _fp in b.GetFootprints():
    for _p in _fp.Pads():
        _n = _p.GetNetname()
        if _n: _np[_n].append((TM(_p.GetPosition().x), TM(_p.GetPosition().y)))
_cand = []
for _n, _ps in _np.items():
    if _n in _PLANE or len(_ps) < 2 or _n in _rnets: continue
    _span = max(math.hypot(_ps[i][0]-_ps[j][0], _ps[i][1]-_ps[j][1]) for i in range(len(_ps)) for j in range(i+1, len(_ps)))
    _cand.append((_prio(_n), round(_span, 1), _n))
_cand.sort()
# The maze routes ONLY the CRITICAL set (short + locked); Freerouting routes everything else around them.
# CRITICAL = prio tiers 1+2 (W5500 support cluster/crystal, buck FB/LX, eth diff pairs + center taps, the
# isolated driver supplies VISO*_DRV, the SPI bus) MINUS the raw power rails (those go to FR + widen_power).
_POWER_RAILS = {"+5V", "+5V_DMX", "+5V_POE", "+5V_USB", "+5V_USBF", "VISO", "VISO2", "VPOE+", "VPOE-"}
def _critical(n): return _prio(n) <= 2 and n not in _POWER_RAILS
# Pass 1 routes ONLY the critical set; on a re-run the criticals are already locked (so the _rnets check
# above drops them from _cand) and this routes whatever is still open -- "the rest" -- in priority order,
# around the locked critical nets. Toggle via env MAZE_CRIT=1 to restrict a fresh run to criticals only.
import os as _os
_critonly = _os.environ.get("MAZE_CRIT") == "1"
NETS = [c[2] for c in _cand if (_critical(c[2]) if _critonly else True)]
NETSET = set(NETS)
print(f"MAZE ROUTE ORDER ({len(NETS)} nets, critonly={_critonly}):")
for c in _cand:
    if c[2] in NETSET: print(f"   P{c[0]} {c[1]:5.1f}mm {c[2]}" + ("  [crit]" if _critical(c[2]) else ""))
bb = b.GetBoardEdgesBoundingBox()
X0, Y0, X1, Y1 = TM(bb.GetLeft())-2, TM(bb.GetTop())-2, TM(bb.GetRight())+2, TM(bb.GetBottom())+2
RES = 0.1
INFL = float(_os.environ.get("MAZE_INFL", "0.19"))   # other-copper inflation = clearance + 0.075 trace-half +
                     # grid margin. Default 0.19 -> ~0.10mm clearance (Fine nets). Raise via MAZE_INFL for a
                     # Default-class net (e.g. 0.24 -> ~0.165mm, clears the 0.15mm Default rule).
VIA_R = 2            # a via (0.5mm pad) needs ~radius-2 (0.2mm) owner neighbourhood free on BOTH layers
TRW = 0.15
VIA_W, VIA_DR = 0.5, 0.2
W = int((X1 - X0) / RES) + 1
H = int((Y1 - Y0) / RES) + 1
FREE, CONF = -2, -1
ownerF = [FREE] * (W * H)
ownerB = [FREE] * (W * H)

def cxx(x): return int(round((x - X0) / RES))
def cyy(y): return int(round((y - Y0) / RES))
def inb(ix, iy): return 0 <= ix < W and 0 <= iy < H

def mk(grid, ix, iy, nc):
    if not inb(ix, iy): return
    i = iy * W + ix; o = grid[i]
    if o == FREE: grid[i] = nc
    elif o != nc and o != CONF: grid[i] = CONF

def disk(grid, x, y, r, nc):
    rc = int(math.ceil(r / RES)); ix0, iy0 = cxx(x), cyy(y); r2 = r * r
    for dx in range(-rc, rc + 1):
        for dy in range(-rc, rc + 1):
            if (dx * RES) ** 2 + (dy * RES) ** 2 <= r2:
                mk(grid, ix0 + dx, iy0 + dy, nc)

def segmark(grid, x0, y0, x1, y1, r, nc):
    n = max(1, int(math.hypot(x1 - x0, y1 - y0) / (RES * 0.6)))
    for k in range(n + 1):
        disk(grid, x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n, r, nc)

def rectmark(grid, l, t, rr, bo, nc):
    for ix in range(cxx(l), cxx(rr) + 1):
        for iy in range(cyy(t), cyy(bo) + 1):
            mk(grid, ix, iy, nc)

# materialize the SWIG iterators ONCE (b.Remove() below invalidates the track iterator)
all_tracks = list(b.GetTracks())
all_fps = list(b.GetFootprints())

# 1) rasterize KEEP copper (everything NOT on the 8 re-routed nets) into ownerF / ownerB (vias into both)
for t in all_tracks:
    if t.GetNetname() in NETSET:
        continue
    nc = t.GetNetCode()
    if isinstance(t, pcbnew.PCB_VIA):
        q = t.GetPosition(); r = TM(t.GetWidth(pcbnew.F_Cu)) / 2 + INFL
        disk(ownerF, TM(q.x), TM(q.y), r, nc); disk(ownerB, TM(q.x), TM(q.y), r, nc)
    else:
        s = t.GetStart(); e = t.GetEnd(); r = TM(t.GetWidth()) / 2 + INFL
        g = ownerF if t.GetLayer() == pcbnew.F_Cu else (ownerB if t.GetLayer() == pcbnew.B_Cu else None)
        if g is not None:
            segmark(g, TM(s.x), TM(s.y), TM(e.x), TM(e.y), r, nc)
padinfo = []   # (netcode, layers, cx, cy)
for fp in all_fps:
    for p in fp.Pads():
        onF, onB = p.IsOnLayer(pcbnew.F_Cu), p.IsOnLayer(pcbnew.B_Cu)
        if not (onF or onB): continue
        nc = p.GetNetCode(); r = p.GetBoundingBox()
        l, tp, rr, bo = TM(r.GetLeft()), TM(r.GetTop()), TM(r.GetRight()), TM(r.GetBottom())
        if onF: rectmark(ownerF, l - INFL, tp - INFL, rr + INFL, bo + INFL, nc)
        if onB: rectmark(ownerB, l - INFL, tp - INFL, rr + INFL, bo + INFL, nc)
        q = p.GetPosition()
        padinfo.append((nc, onF, onB, TM(q.x), TM(q.y)))

# 2) delete the existing 8-net tracks (incl. any prior crossing attempt) -- route them fresh below
for t in all_tracks:
    if t.GetNetname() in NETSET:
        b.Remove(t)

NB = [(-1, 0, 10), (1, 0, 10), (0, -1, 10), (0, 1, 10), (-1, -1, 14), (-1, 1, 14), (1, -1, 14), (1, 1, 14)]
VIA_PEN = 250
_FCU = _os.environ.get("MAZE_FCU") == "1"   # F.Cu-only: never change layer (for iso-side DMX nets that must
                                            # stay off the B.Cu GNDISO pour)

def padcells(nc):
    groups = []
    for (pnc, onF, onB, px, py) in padinfo:
        if pnc != nc: continue
        ix, iy = cxx(px), cyy(py)
        layers = [L for L, on in ((0, onF), (1, onB)) if on]
        groups.append((set((ly, iy * W + ix) for ly in layers), px, py))
    return groups

def route(name):
    nc = b.FindNet(name).GetNetCode()
    groups = padcells(nc)
    if len(groups) < 2:
        return None, f"{name}: <2 pads"

    def freeF(i): o = ownerF[i]; return o == FREE or o == nc
    def freeB(i): o = ownerB[i]; return o == FREE or o == nc
    def freeL(ly, i): return freeF(i) if ly == 0 else freeB(i)
    def via_clear(c):                              # via pad needs radius-VIA_R free on BOTH layers
        cyq, cxq = divmod(c, W)
        for dy in range(-VIA_R, VIA_R + 1):
            for dx in range(-VIA_R, VIA_R + 1):
                nx, ny = cxq + dx, cyq + dy
                if not inb(nx, ny) or not (freeF(ny * W + nx) and freeB(ny * W + nx)):
                    return False
        return True

    connected = set(groups[0][0])         # set of (layer, cell)
    paths = []                             # list of [(layer,cell), ...]
    for (tgt, px, py) in groups[1:]:
        dist = {}; prev = {}
        pq = []
        for st in connected:
            dist[st] = 0; heapq.heappush(pq, (0, st))
        hit = None
        while pq:
            d, (ly, c) = heapq.heappop(pq)
            if d > dist.get((ly, c), 1e18): continue
            if (ly, c) in tgt: hit = (ly, c); break
            cyq, cxq = divmod(c, W)
            for dx, dy, w in NB:
                nx, ny = cxq + dx, cyq + dy
                if not inb(nx, ny): continue
                ni = ny * W + nx
                if not freeL(ly, ni): continue
                nd = d + w
                if nd < dist.get((ly, ni), 1e18):
                    dist[(ly, ni)] = nd; prev[(ly, ni)] = (ly, c); heapq.heappush(pq, (nd, (ly, ni)))
            # via to other layer (same cell) -- only where the via pad fully clears on both layers
            oly = 1 - ly
            if via_clear(c) and not _FCU:
                nd = d + VIA_PEN
                if nd < dist.get((oly, c), 1e18):
                    dist[(oly, c)] = nd; prev[(oly, c)] = (ly, c); heapq.heappush(pq, (nd, (oly, c)))
        if hit is None:
            return None, f"{name}: no path to pad @({px:.1f},{py:.1f})"
        node = hit; path = []
        while node in prev:
            path.append(node); node = prev[node]
        path.append(node); path.reverse()
        for st in path: connected.add(st)
        paths.append(path)
    return paths, "ok"

def commit_obstacles(nc, paths):
    # add this net's routed copper to the owner grids so later nets keep clearance from it
    for path in paths:
        for k in range(len(path)):
            ly, c = path[k]; cyq, cxq = divmod(c, W); x, y = X0 + cxq * RES, Y0 + cyq * RES
            g = ownerF if ly == 0 else ownerB
            disk(g, x, y, TRW / 2 + INFL, nc)
            if k + 1 < len(path) and path[k + 1][0] != ly:           # via here
                disk(ownerF, x, y, VIA_W / 2 + INFL, nc); disk(ownerB, x, y, VIA_W / 2 + INFL, nc)

results = {}; allok = True
for name in NETS:
    paths, msg = route(name)
    print(f"  {name}: {msg}" + (f" ({len(paths)} path(s))" if paths else ""))
    if paths is None:
        allok = False
    else:
        results[name] = paths
        commit_obstacles(b.FindNet(name).GetNetCode(), paths)

if not allok:
    print(f"  (some nets could not be routed -- saving the {len(results)} that did; rest -> next pass / hand-finish)")

# materialize: per path, split into per-layer runs + a via at each layer change
def simplify(cells):   # list of (ix,iy) -> corner points merging collinear
    if len(cells) < 2: return [(X0 + cells[0][0] * RES, Y0 + cells[0][1] * RES)] if cells else []
    cor = [cells[0]]
    for k in range(1, len(cells) - 1):
        ax, ay = cells[k - 1]; bx, by = cells[k]; cx2, cy2 = cells[k + 1]
        if (bx - ax, by - ay) != (cx2 - bx, cy2 - by): cor.append(cells[k])
    cor.append(cells[-1])
    return [(X0 + ix * RES, Y0 + iy * RES) for (ix, iy) in cor]

def padsnap(nc, ly, c):
    cyq, cxq = divmod(c, W); px, py = X0 + cxq * RES, Y0 + cyq * RES
    best = None; bd = 0.6 ** 2
    for (pnc, onF, onB, qx, qy) in padinfo:
        if pnc != nc: continue
        if (ly == 0 and not onF) or (ly == 1 and not onB): continue
        d = (qx - px) ** 2 + (qy - py) ** 2
        if d < bd: bd = d; best = (qx, qy)
    return best or (px, py)

LAYER = {0: pcbnew.F_Cu, 1: pcbnew.B_Cu}
nseg = nvia = 0
for name, paths in results.items():
    nc = b.FindNet(name).GetNetCode()
    for path in paths:
        # split into runs of same layer; emit tracks; at a layer switch emit a via
        k = 0
        while k < len(path):
            ly = path[k][0]; run = []
            while k < len(path) and path[k][0] == ly:
                run.append(divmod(path[k][1], W)[::-1]); k += 1
            corners = simplify(run)
            if corners and k - len(run) == 0:                     # first node of the whole path -> snap to pad
                corners[0] = padsnap(nc, ly, run[0][1] * W + run[0][0])
            if corners and k == len(path):                        # last node -> snap to pad
                corners[-1] = padsnap(nc, ly, run[-1][1] * W + run[-1][0])
            for j in range(len(corners) - 1):
                (ax, ay), (bx, by) = corners[j], corners[j + 1]
                if abs(ax - bx) < 1e-6 and abs(ay - by) < 1e-6: continue
                tr = pcbnew.PCB_TRACK(b); tr.SetStart(pcbnew.VECTOR2I(FM(ax), FM(ay))); tr.SetEnd(pcbnew.VECTOR2I(FM(bx), FM(by)))
                tr.SetWidth(FM(TRW)); tr.SetLayer(LAYER[ly]); tr.SetNetCode(nc); tr.SetLocked(True); b.Add(tr); nseg += 1
            if k < len(path):                                     # a via to the next layer at the boundary cell
                cyq, cxq = divmod(run[-1][1] * W + run[-1][0], W)
                vx, vy = X0 + cxq * RES, Y0 + cyq * RES
                v = pcbnew.PCB_VIA(b); v.SetPosition(pcbnew.VECTOR2I(FM(vx), FM(vy)))
                v.SetViaType(pcbnew.VIATYPE_THROUGH); v.SetDrill(FM(VIA_DR)); v.SetWidth(FM(VIA_W))
                v.SetNetCode(nc); v.SetLayerPair(pcbnew.F_Cu, pcbnew.B_Cu); v.SetLocked(True); b.Add(v); nvia += 1

pcbnew.ZONE_FILLER(b).Fill(b.Zones())
pcbnew.SaveBoard(PCB, b)
print(f"routed {len(results)}/8 nets, {nseg} segments + {nvia} vias, refilled + saved")
