"""EMC placement check: distance from each decoupling/bulk/switcher cap to the nearest power pin of
the IC it serves (pad-to-pad on the shared net). Loop area / decoupling effectiveness scales with this
distance, so switching + HF-decoupling caps must be very close. Re-runnable. KiCad 10 python."""
import pcbnew, math
PCB = r"C:\dev\DMX\hardware\lumigate.kicad_pcb"
TM = pcbnew.ToMM
b = pcbnew.LoadBoard(PCB)

# (cap, ic, shared-net, role, max_mm)
ASSOC = [
    ("C16","U4","+5V","buck IN cap (loop-critical)",5),  ("C17","U4","+3V3","buck OUT cap",6),
    ("L1","U4","BUCK_LX","buck inductor",6),
    ("C1","U1","+3V3","ESP32 HF decap",6),               ("C2","U1","+3V3","ESP32 bulk",10),
    ("C8","U2","+3V3","W5500 decap",5),  ("C9","U2","+3V3","W5500 decap",5),
    ("C10","U2","+3V3","W5500 decap",5), ("C11","U2","+3V3","W5500 decap",5),
    ("C4","U2","W5500_1V2","W5500 1V2 cap",5), ("C5","U2","W5500_1V2","W5500 1V2 cap",5),
    ("C6","U2","TOCAP","W5500 TOCAP",6),
    ("C12","U2","XI","xtal load",6), ("C13","U2","XO","xtal load",6), ("Y1","U2","XI","crystal",8),
    ("C18","U5","+3V3","ISO3086#1 VCC1",5), ("C19","U5","VISO","ISO3086#1 VCC2",5), ("C20","U5","VISO","ISO3086#1 bulk",8),
    ("C23","U6","+3V3","ISO3086#2 VCC1",5), ("C24","U6","VISO2","ISO3086#2 VCC2",5), ("C25","U6","VISO2","ISO3086#2 bulk",8),
    ("C27","U7","+5V_POE","PoE out bulk",10), ("C28","U7","+5V_POE","PoE out cap",10),
    ("C21","PS1","+5V","B0505S#1 in cap",8), ("C26","PS2","+5V","B0505S#2 in cap",8),
    ("D1","J1","DMX_A","DMX1 TVS near XLR",10), ("D7","J5","DMX2_A","DMX2 TVS near XLR",10),
]

def pads_on(ref, net):
    fp = b.FindFootprintByReference(ref)
    if not fp: return []
    return [p.GetPosition() for p in fp.Pads() if p.GetNetname() == net]

print(f"{'cap':4} {'ic':4} {'net':10} {'role':26} {'dist':7} verdict")
worst = []
for cap, ic, net, role, mx in ASSOC:
    cp = pads_on(cap, net); ip = pads_on(ic, net)
    if not cp or not ip:
        print(f"{cap:4} {ic:4} {net:10} {role:26} {'?':>6}  (net not on both -- check)"); continue
    dmin = min(math.hypot(TM(a.x)-TM(c.x), TM(a.y)-TM(c.y)) for a in cp for c in ip)
    ok = dmin <= mx
    if not ok: worst.append((cap, ic, dmin, mx, role))
    print(f"{cap:4} {ic:4} {net:10} {role:26} {dmin:5.1f}mm  {'OK' if ok else f'FAR (>{mx}mm) -> move closer'}")
print("-"*70)
if worst:
    print("PLACEMENT FINDINGS (move these caps next to their IC pin):")
    for cap, ic, d, mx, role in sorted(worst, key=lambda x:-x[2]):
        print(f"  {cap} -> {ic}: {d:.1f}mm (want <={mx}mm)  [{role}]")
else:
    print("all decoupling/switcher caps within target distance")
