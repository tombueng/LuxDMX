"""EMC placement check: distance from each decoupling/bulk/switcher cap (and the supply ferrites) to the
nearest power pin of the IC it serves (pad-to-pad on the shared net). Loop area / decoupling effectiveness
scales with this distance, so switching + HF-decoupling caps must sit very close.

Importable as check_placement(PCB) -> list of (part, ic, dist, max, role) violations, so the fab pipeline
(gen_gerbers.py) reports drift on EVERY board change. Runnable standalone (exits non-zero on any violation)
so it can also be used as a CI/manual gate. Re-runnable. KiCad 10 python."""
import pcbnew, math, sys

PCB = r"C:\dev\DMX\hardware\luxdmx.kicad_pcb"

# (cap/ferrite, ic, shared-net, role, max_mm)  -- mirrors place_decoupling.py's intent (which IC pin each
# support part serves). Keep in sync with it. Distances are pad-to-pad on the shared net.
ASSOC = [
    ("C16","U4","+5V","buck IN cap (loop-critical)",5),  ("C17","L1","+3V3","buck OUT cap",6),
    ("L1","U4","BUCK_LX","buck inductor",6),
    ("C1","U1","+3V3","ESP32 HF decap",6),               ("C2","U1","+3V3","ESP32 bulk",10),
    ("C8","U2","+3V3","W5500 decap",5),  ("C9","U2","+3V3","W5500 decap",5),
    ("C10","U2","+3V3","W5500 decap",5), ("C11","U2","+3V3","W5500 decap",5),
    ("C4","U2","W5500_1V2","W5500 1V2 cap",5), ("C5","U2","W5500_1V2","W5500 1V2 cap",5),
    ("C6","U2","TOCAP","W5500 TOCAP",6),
    ("C12","U2","XI","xtal load",6), ("C13","U2","XO","xtal load",6), ("Y1","U2","XI","crystal",8),
    ("C18","U5","+3V3","ISO3086#1 VCC1",5), ("C19","U5","VISO_DRV","ISO3086#1 VCC2 (after FB2)",5), ("C20","PS1","VISO","ISO3086#1 DC-DC bulk",8),
    ("C23","U6","+3V3","ISO3086#2 VCC1",5), ("C24","U6","VISO2_DRV","ISO3086#2 VCC2 (after FB3)",5), ("C25","PS2","VISO2","ISO3086#2 DC-DC bulk",8),
    ("C27","U7","+5V_POE","PoE out bulk",10), ("C28","U7","+5V_POE","PoE out cap",10),
    ("C21","PS1","+5V_DMX","B0505S#1 in cap",8), ("C26","PS2","+5V_DMX","B0505S#2 in cap",8),
    ("D1","L2","DMX_AO","DMX1 TVS (cable-side, by the choke)",10), ("D7","L3","DMX2_AO","DMX2 TVS (cable-side, by the choke)",10),
    # supply ferrites: series pi-filter elements, but they still want short supply traces -> keep in the cluster
    ("FB1","PS1","+5V_DMX","B0505S supply ferrite (in)",9),
    ("FB2","U5","VISO_DRV","DMX-A VISO ferrite (out)",9),
    ("FB3","U6","VISO2_DRV","DMX-B VISO ferrite (out)",9),
    # NB: L2/L3 (cable-side common-mode chokes) sit at the XLR by design -> intentionally NOT proximity-checked.
]


def _pads_on(b, ref, net):
    fp = b.FindFootprintByReference(ref)
    if not fp:
        return []
    return [p.GetPosition() for p in fp.Pads() if p.GetNetname() == net]


def check_placement(pcb=PCB, verbose=True):
    """Measure each support part's distance to its IC pin. Returns the list of violations
    (part, ic, dist, max_mm, role). Prints a full report when verbose."""
    TM = pcbnew.ToMM
    b = pcbnew.LoadBoard(pcb)
    worst = []
    if verbose:
        print(f"{'part':4} {'ic':4} {'net':11} {'role':28} {'dist':7} verdict")
    for cap, ic, net, role, mx in ASSOC:
        cp = _pads_on(b, cap, net); ip = _pads_on(b, ic, net)
        if not cp or not ip:
            if verbose:
                print(f"{cap:4} {ic:4} {net:11} {role:28} {'?':>6}  (net not on both -- check)")
            continue
        dmin = min(math.hypot(TM(a.x) - TM(c.x), TM(a.y) - TM(c.y)) for a in cp for c in ip)
        ok = dmin <= mx
        if not ok:
            worst.append((cap, ic, dmin, mx, role))
        if verbose:
            print(f"{cap:4} {ic:4} {net:11} {role:28} {dmin:5.1f}mm  {'OK' if ok else f'FAR (>{mx}mm)'}")
    if verbose:
        print("-" * 74)
        if worst:
            print(f"[placement] {len(worst)} part(s) too far from their IC pin (move closer, or re-run place_decoupling.py):")
            for cap, ic, d, mx, role in sorted(worst, key=lambda x: -x[2]):
                print(f"  {cap} -> {ic}: {d:.1f}mm (want <= {mx}mm)  [{role}]")
        else:
            print("[placement] all decoupling/switcher caps + supply ferrites within target distance")
    return worst


if __name__ == "__main__":
    sys.exit(1 if check_placement() else 0)
