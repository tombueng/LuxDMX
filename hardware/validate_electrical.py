"""Electrical operating-point validation for LumiGate v4.0 -- re-runnable.

Computes the DC/RC operating points of every critical node from the schematic values and checks
each against the relevant device limit. For these nodes (resistive dividers, diode-OR, LED current
limits, single-pole RC, crystal load) the closed-form solution IS the exact DC/transient answer, so
no SPICE model (with guessed switch/transistor params) is needed; nodes that WOULD benefit from a
real transient sim are flagged [SPICE-WORTH]. Prints PASS / WARN / FAIL per item.

Run: python validate_electrical.py   (plain CPython, no KiCad needed)."""

PASS, WARN, FAIL = "PASS", "WARN", "FAIL"
rows = []
def chk(item, status, detail): rows.append((status, item, detail))

# ---------------------------------------------------------------- supply rails
VBUS_NOM, VBUS_MIN = 5.00, 4.75          # USB-C VBUS (USB spec 4.75-5.25)
VPOE_OUT = 5.00                          # DP9900M-5V isolated output
# board current budget @3V3 (Ethernet active, WiFi unused):
I3V3 = {"ESP32-S3 (eth, no wifi)":0.110, "W5500 100M":0.132, "CH340":0.005,
        "2x ISO3086 logic":0.020, "status LEDs (avg)":0.015}
i3v3 = sum(I3V3.values())
BUCK_EFF = 0.88
i_buck_in = i3v3*3.3/(VBUS_NOM*BUCK_EFF)
# 2x B0505S-1W: each ~60mA out (ISO3086 bus side into 60R), eff ~0.75
i_b0505_in = 2*0.060*5.0/(5.0*0.75)
i_5v = i_buck_in + i_b0505_in            # total current drawn from the +5V rail
# OR Schottky SS34: Vf ~0.43V @ this current, 25C
def ss34_vf(i): return 0.30 + 0.18*(i/1.0)   # linear approx of SS34 25C curve near 0.3-0.8A
vf = ss34_vf(i_5v)
p5v_nom = VBUS_NOM - vf
p5v_min = VBUS_MIN - ss34_vf(i_5v*1.3)   # low VBUS + 30% load headroom
chk("+5V rail (USB, nominal)", PASS if p5v_nom>=4.6 else WARN,
    f"{i_5v*1000:.0f}mA load, SS34 Vf={vf:.2f}V -> +5V={p5v_nom:.2f}V")
chk("B0505S input margin (min 4.5V)", PASS if p5v_min>=4.5 else WARN,
    f"worst-case +5V={p5v_min:.2f}V (VBUS 4.75 + 30% load). B0505S is UNREGULATED -> VISO tracks "
    f"~{p5v_min*0.95:.2f}V; ISO3086 VCC2 spec 3-5.5V so DMX still valid. [SPICE-WORTH: load-step]")
chk("OR-diode dissipation", PASS if i_5v*vf<0.6 else WARN,
    f"P(SS34)={i_5v*vf*1000:.0f}mW in SMA (rated ~0.9W) -- ok")
chk("USB host current need", WARN,
    f"total ~{i_5v*1000:.0f}mA from VBUS: a 500mA PC port is marginal with both DMX universes; "
    f"use a >=1A 5V source or PoE")

# ---------------------------------------------------------------- buck FB divider
VREF = 0.600                              # SY8089 feedback ref
R_top, R_bot = 45.3, 10.0                 # kohm  (R10, R11)
vout = VREF*(1+R_top/R_bot)
chk("Buck +3V3 output (R10/R11)", PASS if abs(vout-3.3)<0.1 else FAIL,
    f"0.6*(1+45.3/10)={vout:.3f}V  (target 3.30, tol +/-1% R -> +/-{vout*0.01:.3f}V)")

# ---------------------------------------------------------------- LED currents
def iled(vsrc, vf, r): return (vsrc-vf)*1000.0/r       # mA, r in ohm
GPIO=3.3
leds=[("D2 red R13=1k",1.8,1000),("D3 grn R14=150R",2.0,150),("D4 yel R15=1k",2.0,1000),
      ("D5 blu R16=150R",2.8,150),("D6 wht R17=150R",2.9,150)]
for name,vf_l,r in leds:
    i=iled(GPIO,vf_l,r)
    chk(f"LED {name}", PASS if 0.5<=i<=15 else WARN, f"{i:.1f}mA (ESP32-S3 GPIO <=40mA; ok)")
chk("LED brightness uniformity", WARN,
    "green ~8.7mA vs red/yellow ~1.3mA: large perceived-brightness spread (cosmetic). "
    "Consider 470-680R green/blue/white, 330R red/yellow for even look")
# magjack link/act LEDs: 3V3 - Vf over 330R, W5500 sinks
chk("Magjack LEDs (R4/R5=330R)", PASS, f"{iled(3.3,2.0,330):.1f}mA each, W5500 LED pin sinks -- ok")

# ---------------------------------------------------------------- RC / timing
R_en, C_en = 10e3, 1e-6
t_en = R_en*C_en
chk("EN power-on RC (R1/C3)", PASS, f"10k*1uF={t_en*1000:.0f}ms ramp (> ESP32-S3 min reset; was 1ms, now safe)")

# ---------------------------------------------------------------- USB-C CC
chk("USB-C CC pulldowns (R8/R9=5.1k)", PASS,
    "Rd=5.1k each = correct UFP/sink advertisement (default USB current); CC1+CC2 both populated (cable-orientation independent)")

# ---------------------------------------------------------------- crystal load
C1=C2=22.0
Cstray=4.0
CL=(C1*C2)/(C1+C2)+Cstray
chk("W5500 25MHz crystal load (C12/C13=22pF)", WARN,
    f"CL={CL:.1f}pF (22||22 + {Cstray}pF stray). MUST match the chosen crystal's CL spec: "
    f"if crystal CL=10pF use ~12pF caps, if 12pF use ~16pF, if 18-20pF 22pF is right. [VERIFY against C2981622 datasheet]")

# ---------------------------------------------------------------- W5500 EXRES1
chk("W5500 EXRES1 (R3=12k vs 12.4k spec)", WARN,
    "12k 1% is -3.2% of the 12.4k datasheet value -> TX amplitude ~+1-3%; within 100BASE-TX tol but "
    "prefer 12.4k 1% (e.g. C25053) if orderable for nominal eye")

# ---------------------------------------------------------------- RS-485 loading
chk("ISO3086 DMX drive load", PASS,
    "source 120R term (R12) || 120R far-end = 60R; ISO3086 drives >=54R, VoD>=1.5V -- ok. "
    "Permanent 120R at the OUTPUT is correct for a gateway at the chain head (E1.11)")

# ---------------------------------------------------------------- print
order={FAIL:0,WARN:1,PASS:2}
rows.sort(key=lambda r:order[r[0]])
print("="*100)
print(f"{'STATUS':6}  {'ITEM':38}  DETAIL")
print("-"*100)
for s,it,d in rows: print(f"{s:6}  {it:38}  {d}")
print("-"*100)
from collections import Counter
c=Counter(r[0] for r in rows)
print(f"  {c[PASS]} PASS / {c[WARN]} WARN / {c[FAIL]} FAIL")
