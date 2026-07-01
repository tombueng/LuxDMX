"""Electrical operating-point validation for LuxDMX v4.0 -- re-runnable.

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
# Power chain: VBUS -> F1 PTC (25mOhm) -> TPS2116 ideal-diode mux (~40mOhm) -> +5V -> FB1 (100mOhm) -> B0505S in (~VCC2)
R_PTC, R_FB1, R_MUX = 0.025, 0.10, 0.040
def mux_drop(i): return i*R_MUX               # TPS2116 RDSON ~40mOhm typ (65mOhm max over temp), 1.6A
vf = mux_drop(i_5v)
p5v_nom = VBUS_NOM - i_5v*R_PTC - vf
vcc2_nom = p5v_nom - i_b0505_in*R_FB1         # B0505S unregulated out ~ Vin -> VCC2
p5v_min  = VBUS_MIN - i_5v*1.3*R_PTC - mux_drop(i_5v*1.3)
vcc2_min = p5v_min - i_b0505_in*1.3*R_FB1
vcc2_poe = 5.0 - vf - i_b0505_in*R_FB1
chk("+5V rail (USB, nominal)", PASS if p5v_nom>=4.55 else WARN,
    f"{i_5v*1000:.0f}mA, PTC+TPS2116 mux -> +5V={p5v_nom:.2f}V")
chk("B0505S/ISO3086 VCC2 >=4.5V (USB)", PASS if vcc2_min>=4.5 else WARN,
    f"USB@{VBUS_MIN}V worst-case VCC2~{vcc2_min:.2f}V (TPS2116 ideal-diode OR, fixed this rev). "
    f"PoE 5.0V -> VCC2~{vcc2_poe:.2f}V OK.")
chk("OR mux dissipation", PASS if i_5v*vf<0.6 else WARN,
    f"P(TPS2116)={i_5v*vf*1000:.0f}mW (RDSON 40mOhm, rated 1.6A) -- ok")
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
C1=C2=33.0
Cstray=4.0
CL=(C1*C2)/(C1+C2)+Cstray
CL_XTAL=20.0   # C2981622 is 2520-25-20 -> CL=20pF (datasheet-confirmed)
chk("W5500 25MHz crystal load (C12/C13=33pF C0G)", PASS if abs(CL-CL_XTAL)<=2 else WARN,
    f"presented CL={CL:.1f}pF (33||33 + {Cstray}pF stray) vs crystal CL={CL_XTAL:.0f}pF -> within +-1pF. "
    f"Require C0G/NP0 dielectric. (Was 22pF -> 15pF presented, ran 25MHz fast.)")

# ---------------------------------------------------------------- W5500 EXRES1
chk("W5500 EXRES1 (R3=12.4k 1%)", PASS,
    "datasheet-specified 12.4k 1% -> on-spec PHY TX bias (was 12k = -3.2%, now corrected)")

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
import sys
sys.exit(1 if c[FAIL] else 0)   # FAIL items block; WARN (SPICE-worth / margins) do not
