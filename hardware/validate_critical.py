"""Signal-integrity quality check of the CRITICAL nets, re-runnable. For every routing change this catches
quality regressions that DRC/connectivity won't:

  * Ethernet MDI pairs (TXN/TXP, RXN/RXP): routed length, via count, intra-pair length skew
  * crystal (XI/XO): length + that it stayed via-free on one layer
  * eth center taps + the SPI bus: length, via count, detour vs straight-line span
  * net-class track-width consistency (Fine 0.15 / Default 0.20 / Power >=0.30)

These are SI targets, not fab blockers -- a crystal trace that grew long or sprouted a via, an MDI pair
with a detour/extra via or big skew, or a net routed at the wrong width, all degrade quality. Exits 1 if
any target is missed (validate_all.sh surfaces it as a soft warning; it does not block fab). KiCad 10."""
import pcbnew, math, sys
from collections import defaultdict

PCB = r"C:\dev\DMX\hardware\luxdmx.kicad_pcb"
TM = pcbnew.ToMM
b = pcbnew.LoadBoard(PCB)

pos = defaultdict(list)
for f in b.GetFootprints():
    for p in f.Pads():
        n = p.GetNetname()
        if n:
            q = p.GetPosition()
            pos[n].append((TM(q.x), TM(q.y)))


def stats(net):
    L = v = 0
    for t in b.GetTracks():
        if t.GetNetname() != net:
            continue
        if isinstance(t, pcbnew.PCB_VIA):
            v += 1
        else:
            s, e = t.GetStart(), t.GetEnd()
            L += math.hypot(TM(e.x) - TM(s.x), TM(e.y) - TM(s.y))
    pts = pos.get(net, [])
    span = max((math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1])
                for i in range(len(pts)) for j in range(i + 1, len(pts))), default=0)
    return L, v, span


W = []
def chk(cond, msg):
    if not cond:
        W.append(msg)


print("=== Ethernet MDI pairs (target: <=30mm, <=1 via, skew <=15mm) ===")
for a, c in (("ETH_TXN", "ETH_TXP"), ("ETH_RXN", "ETH_RXP")):
    La, va, _ = stats(a); Lc, vc, _ = stats(c)
    print(f"  {a}/{c:8}: {La:5.1f}/{Lc:5.1f}mm   {va}/{vc} via   skew {abs(La - Lc):4.1f}mm")
    for n, L, v in ((a, La, va), (c, Lc, vc)):
        chk(L <= 30, f"{n}: {L:.1f}mm > 30mm")
        chk(v <= 1, f"{n}: {v} vias (>1)")
    chk(abs(La - Lc) <= 15, f"{a}/{c}: pair skew {abs(La - Lc):.1f}mm > 15mm")

print("=== crystal (target: <=12mm, 0 vias) ===")
for n in ("XI", "XO"):
    L, v, sp = stats(n)
    print(f"  {n:8}: {L:5.1f}mm   {v} via   {(L / sp if sp else 0):.2f}x")
    chk(L <= 12, f"{n}: crystal {L:.1f}mm > 12mm")
    chk(v == 0, f"{n}: crystal has {v} via(s) (keep on one layer)")

print("=== eth center taps + SPI bus (target: <=3 vias, detour <=2.5x) ===")
for n in ("ETH_TCT", "ETH_RCT", "SCLK", "MOSI", "MISO", "ETH_CS", "ETH_INT", "ETH_RST"):
    L, v, sp = stats(n); d = L / sp if sp else 0
    print(f"  {n:8}: {L:5.1f}mm   {v} via   {d:.2f}x")
    chk(v <= 3, f"{n}: {v} vias (>3)")
    chk(d <= 2.5, f"{n}: detour {d:.1f}x > 2.5x")

print("=== net-class track-width consistency ===")
POWER = {"+5V", "+5V_POE", "+5V_DMX", "+5V_USB", "+5V_USBF", "VPOE+", "VPOE-", "VISO", "VISO2"}
FINE = {"ETH_TXN", "ETH_TXP", "ETH_RXN", "ETH_RXP", "ETH_TCT", "ETH_RCT", "ETH_CS", "ETH_INT", "ETH_RST",
        "SCLK", "MOSI", "MISO", "TOCAP", "W5500_1V2", "XI", "XO",
        "N$1", "N$3", "N$4", "N$5", "N$6", "N$7", "N$8", "N$9", "N$10"}
PLANE = {"GND", "+3V3", "GNDISO", "GNDISO2"}
wmin = defaultdict(lambda: 9.0); wmax = defaultdict(float)
for t in b.GetTracks():
    if t.Type() != pcbnew.PCB_TRACE_T:
        continue
    n = t.GetNetname(); w = TM(t.GetWidth())
    cls = "Power" if n in POWER else ("Fine" if n in FINE else ("Plane" if n in PLANE else "Default"))
    wmin[cls] = min(wmin[cls], w); wmax[cls] = max(wmax[cls], w)
    if n in FINE and n not in ("ETH_TXN", "ETH_TXP", "ETH_RXN", "ETH_RXP") and w > 0.18:
        # the 4 MDI pairs are DELIBERATELY widened toward ~50 ohm SE by widen_eth.py -> not a defect
        chk(False, f"{n} (Fine) routed at {w:.2f}mm (expected 0.15)")
    if cls == "Default" and w < 0.149:
        chk(False, f"{n} (Default) routed at {w:.2f}mm (<0.15)")
for cls in ("Power", "Default", "Fine"):
    if cls in wmax:
        print(f"  {cls:8}: {wmin[cls]:.2f}..{wmax[cls]:.2f}mm")

print("-" * 62)
if W:
    print(f"[critical] {len(W)} signal-integrity warning(s):")
    for w in W:
        print("  ! " + w)
else:
    print("[critical] all critical nets within SI targets (length / vias / skew / detour / class width)")
sys.exit(1 if W else 0)
