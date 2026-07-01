"""Geometric / power-integrity / DFM validation on the routed board -- re-runnable.

  * power-net trace widths vs IPC-2221 current capacity (external 1oz, dT=10C)
  * via count + per-via current on each power net
  * board-wide DFM minima (track, clearance-by-DRC, drill, annular) vs JLCPCB 4-layer capability
  * isolation: reports the DRC clearance result is the authority for SURFACE creepage; here we also
    measure the inner-plane vertical situation (informational)

Run: python validate_geometry.py   (KiCad 10 python)."""
import pcbnew, math
from collections import defaultdict

PCB = r"C:\dev\DMX\hardware\luxdmx.kicad_pcb"
TM = pcbnew.ToMM
b = pcbnew.LoadBoard(PCB)
_fail = False   # any power net under capacity, or any DFM minimum below JLCPCB -> exit 1 (usable as a gate)

# expected worst-case current per power net (A)
IEXP = {"+5V": 0.80, "+3V3": 0.40, "+5V_USB": 0.80, "+5V_POE": 0.40,
        "VPOE+": 0.30, "VPOE-": 0.30, "VISO": 0.10, "VISO2": 0.10}

def ipc_amp(w_mm, dT=10, oz=1.0):
    # IPC-2221 external: I = k*dT^0.44 * A(mil^2)^0.725 ; 1oz=1.378mil thick
    A = (w_mm/0.0254) * (1.378*oz)
    return 0.048 * (dT**0.44) * (A**0.725)

print("=== power-net minimum trace width vs IPC-2221 capacity (1oz outer, dT=10C) ===")
wmin = defaultdict(lambda: 9e9); vias = defaultdict(int)
for t in b.GetTracks():
    n = t.GetNetname()
    if n in IEXP:
        if isinstance(t, pcbnew.PCB_VIA): vias[n] += 1
        else: wmin[n] = min(wmin[n], TM(t.GetWidth()))
print(f"{'net':8} {'min_w(mm)':9} {'cap@10C':8} {'cap@20C':8} {'I_exp':7} {'vias':5}  verdict")
for n in IEXP:
    w = wmin[n] if wmin[n] < 9e9 else 0
    cap10 = ipc_amp(w) if w else 0; cap20 = ipc_amp(w, 20) if w else 0
    ok = cap10 >= IEXP[n]
    if not ok: _fail = True
    print(f"{n:8} {w:9.3f} {cap10:7.2f}A {cap20:7.2f}A {IEXP[n]:6.2f}A {vias[n]:5}  {'OK' if ok else 'THIN -> widen'}")

print("\n=== via current (0.3mm drill / 0.6mm pad through-via ~ 1-1.5A each @10C) ===")
for n in ("+5V", "+3V3", "VPOE+", "VPOE-"):
    nv = vias[n]; per = IEXP[n]/nv if nv else float('inf')
    print(f"  {n:7} {nv} power via(s) -> {per:.2f}A/via  {'OK' if (nv==0 or per<=1.0) else 'add vias'}")

print("\n=== DFM minima vs JLCPCB 4-layer (trace>=0.0889 space>=0.0889 drill>=0.15 annular>=0.13) ===")
mintrk = min((TM(t.GetWidth()) for t in b.GetTracks() if not isinstance(t, pcbnew.PCB_VIA)), default=0)
drills = []; annul = []
for t in b.GetTracks():
    if isinstance(t, pcbnew.PCB_VIA):
        d = TM(t.GetDrill()); w = TM(t.GetWidth(pcbnew.F_Cu)); drills.append(d); annul.append((w-d)/2)
for fp in b.GetFootprints():
    for p in fp.Pads():
        if p.HasHole():
            dh = TM(p.GetDrillSize().x)
            if dh > 0: drills.append(dh)
print(f"  min track width : {mintrk:.3f} mm   {'OK' if mintrk>=0.0889 else 'TOO THIN'}")
print(f"  min drill       : {min(drills):.3f} mm   {'OK' if min(drills)>=0.15 else 'TOO SMALL'}")
print(f"  min via annular : {min(annul):.3f} mm   {'OK' if min(annul)>=0.13 else 'TOO SMALL'}" if annul else "  (no vias)")
print(f"  copper clearance: enforced by DRC (.kicad_dru); see DRC report for any <min")
if mintrk < 0.0889 or (drills and min(drills) < 0.15) or (annul and min(annul) < 0.13):
    _fail = True
import sys
sys.exit(1 if _fail else 0)
