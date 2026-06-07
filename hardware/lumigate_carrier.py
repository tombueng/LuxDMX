#!/usr/bin/env python
"""LumiGate carrier PCB — schematic as code (SKiDL).

Generates a KiCad netlist (lumigate_carrier.net) for the Olimex ESP32-POE-ISO
carrier board: isolated ADM2587E DMX/RDM output (XLR-5), USB-C power inlet, and
a WS2812 RGB status LED. See ../docs/hardware.md for the full design rationale.

All parts are defined as SKIDL-tool parts (explicit pins + footprints) so no KiCad
symbol libraries are required to regenerate. ADM2587E pin numbers (U2) are taken
directly from the ADI ADM2582E/ADM2587E datasheet pin-configuration table.

Custom footprints still to be drawn (project library "LumiGate"):
  - Olimex_ESP32-POE-ISO_socket   (2x female-header sockets matching the module)
  - XLR5_PCB                       (chosen XLR-5 vendor, e.g. Neutrik NC5)

Regenerate:
  python lumigate_carrier.py        # writes lumigate_carrier.net next to this file
"""
import os
from skidl import Part, Pin, Net, TEMPLATE, SKIDL, generate_netlist, ERC, set_default_tool, KICAD9

set_default_tool(KICAD9)
PT = Pin.types
HERE = os.path.dirname(os.path.abspath(__file__))


def mk(name, prefix, fp, pins, value=None):
    t = Part(tool=SKIDL, name=name, ref_prefix=prefix, dest=TEMPLATE)
    for num, pname, func in pins:
        t += Pin(num=str(num), name=pname, func=func)
    t.footprint = fp
    if value:
        t.value = value
    return t


def two(name, prefix, fp, value):
    return mk(name, prefix, fp, [(1, '1', PT.PASSIVE), (2, '2', PT.PASSIVE)], value)()


# ---- Nets -------------------------------------------------------------------
P3V3 = Net('+3V3'); P5V = Net('+5V'); GND = Net('GND')          # logic side (GND1)
GND2 = Net('GNDISO'); VISO = Net('VISO')                        # isolated bus side (GND2)
DMX_TX = Net('DMX_TX'); DMX_RX = Net('DMX_RX'); DMX_EN = Net('DMX_EN')
DMX_A = Net('DMX_A'); DMX_B = Net('DMX_B')                      # A=Data+ (Y/A), B=Data- (Z/B)
RGB_DIN = Net('RGB_DIN'); RGB_5V = Net('RGB_DIN_5V'); LED_DIN = Net('LED_DIN')
VBUS = Net('VBUS_C'); VBUS_F = Net('VBUS_FUSED'); CC1 = Net('CC1'); CC2 = Net('CC2')

# ---- J3 / J4  module sockets (two 1x10 female, 2.54mm pitch, 25.4mm apart) ---
# The ESP module plugs in here (JLCPCB-assembled sockets, C35445). Pin map follows
# the Olimex ESP32-POE-ISO Rev.I header: J3 = EXT1 (pins 1-10), J4 = EXT2 (1-10).
# Only the pins LumiGate uses are netted; the rest are free passthrough.
# NB: the module itself is NOT a netlist part — it plugs in. On the board it is the
# pad-less footprint "U1" carrying only the 3D model (excluded from BOM/POS).
sockpins = [(i, str(i), PT.PASSIVE) for i in range(1, 11)]
sock = mk('Conn_1x10_socket', 'J', 'Sock1x10:HDR-TH_10P-P2.54-V-F', sockpins,
          value='1x10 socket 2.54 (C35445)')
J3 = sock(); J3.ref = 'J3'        # EXT1
J3[1] += P5V          # EXT1.1  +5V
J3[2] += P3V3         # EXT1.2  +3.3V
J3[3] += GND          # EXT1.3  GND
J3[9] += DMX_TX       # EXT1.9  GPIO4  -> DI
J4 = sock(); J4.ref = 'J4'        # EXT2
J4[2] += DMX_RX       # EXT2.2  GPIO36 -> RO
J4[5] += RGB_DIN      # EXT2.5  GPIO33 -> RGB data
J4[6] += DMX_EN       # EXT2.6  GPIO32 -> DE/RE

# ---- U2  ADM2587E isolated RS-485 transceiver (datasheet pinout) -------------
adm = mk('ADM2587E', 'U', 'Package_SO:SOIC-20W_7.5x12.8mm_P1.27mm',
         [(1, 'GND1', PT.PWRIN), (2, 'VDD', PT.PWRIN), (3, 'GND1', PT.PWRIN),
          (4, 'RxD', PT.OUTPUT), (5, 'RE', PT.INPUT), (6, 'DE', PT.INPUT),
          (7, 'TxD', PT.INPUT), (8, 'VDD', PT.PWRIN), (9, 'GND1', PT.PWRIN),
          (10, 'GND1', PT.PWRIN), (11, 'GND2', PT.PWRIN), (12, 'VISOOUT', PT.PWROUT),
          (13, 'Y', PT.OUTPUT), (14, 'GND2', PT.PWRIN), (15, 'Z', PT.OUTPUT),
          (16, 'GND2', PT.PWRIN), (17, 'B', PT.BIDIR), (18, 'A', PT.BIDIR),
          (19, 'VISOIN', PT.PWRIN), (20, 'GND2', PT.PWRIN)],
         value='ADM2587EBRWZ')
U2 = adm(); U2.ref = 'U2'
U2['VDD'] += P3V3
U2['GND1'] += GND
U2['RxD'] += DMX_RX
U2['TxD'] += DMX_TX
U2['RE'] += DMX_EN          # /RE and DE tied together -> single direction line (RDM)
U2['DE'] += DMX_EN
U2['GND2'] += GND2
U2['VISOOUT'] += VISO       # pin 12 <-> pin 19 MUST be tied externally (datasheet)
U2['VISOIN'] += VISO
U2['Y'] += DMX_A; U2['A'] += DMX_A   # 2-wire half-duplex: Y-A = Data+
U2['Z'] += DMX_B; U2['B'] += DMX_B   # 2-wire half-duplex: Z-B = Data-

# ---- U3  74LVC1G125 level buffer (3V3 -> 5V data for RGB) --------------------
buf = mk('74LVC1G125', 'U', 'Package_TO_SOT_SMD:SOT-23-5',
         [(1, 'OE', PT.INPUT), (2, 'A', PT.INPUT), (3, 'GND', PT.PWRIN),
          (4, 'Y', PT.OUTPUT), (5, 'VCC', PT.PWRIN)], value='74LVC1G125')
U3 = buf(); U3.ref = 'U3'
U3['OE'] += GND            # active-low output enable -> always on
U3['A'] += RGB_DIN
U3['Y'] += RGB_5V
U3['VCC'] += P5V
U3['GND'] += GND

# ---- Decoupling -------------------------------------------------------------
C1 = two('C', 'C', 'Capacitor_SMD:C_0805_2012Metric', '100nF'); C1.ref = 'C1'
C1[1] += P3V3; C1[2] += GND                       # U2 VDD bypass
C2 = two('C', 'C', 'Capacitor_SMD:C_1206_3216Metric', '10uF'); C2.ref = 'C2'
C2[1] += P3V3; C2[2] += GND                       # U2 VDD bulk
C3 = two('C', 'C', 'Capacitor_SMD:C_0805_2012Metric', '100nF'); C3.ref = 'C3'
C3[1] += VISO; C3[2] += GND2                      # VISO bypass
C4 = two('C', 'C', 'Capacitor_SMD:C_1206_3216Metric', '10uF'); C4.ref = 'C4'
C4[1] += VISO; C4[2] += GND2                      # VISO bulk
C5 = two('C', 'C', 'Capacitor_SMD:C_0805_2012Metric', '100nF'); C5.ref = 'C5'
C5[1] += P3V3; C5[2] += GND                       # 3V3 header bulk
C6 = two('C', 'C', 'Capacitor_SMD:C_0805_2012Metric', '100nF'); C6.ref = 'C6'
C6[1] += P5V; C6[2] += GND                        # RGB LED bypass
C7 = two('C', 'C', 'Capacitor_SMD:C_0805_2012Metric', '100nF'); C7.ref = 'C7'
C7[1] += P5V; C7[2] += GND                        # buffer VCC bypass

# ---- DMX bus protection / termination (GND2 domain) -------------------------
R1 = two('R', 'R', 'Resistor_SMD:R_0805_2012Metric', '120R'); R1.ref = 'R1'
R1[1] += DMX_A; R1[2] += DMX_B                    # 120R DMX termination, hardwired (no jumper)

D1 = mk('SM712', 'D', 'Package_TO_SOT_SMD:SOT-23',
        [(1, 'IO1', PT.PASSIVE), (2, 'GND', PT.PASSIVE), (3, 'IO2', PT.PASSIVE)],
        value='SM712')
U_tvs = D1(); U_tvs.ref = 'D1'
U_tvs['IO1'] += DMX_A; U_tvs['GND'] += GND2; U_tvs['IO2'] += DMX_B

R2 = two('R', 'R', 'Resistor_SMD:R_0805_2012Metric', '10k'); R2.ref = 'R2'
R2[1] += DMX_EN; R2[2] += GND                     # safe-on-boot: default receive

# ---- RGB LED ----------------------------------------------------------------
R6 = two('R', 'R', 'Resistor_SMD:R_0805_2012Metric', '330R'); R6.ref = 'R6'
R6[1] += RGB_5V; R6[2] += LED_DIN
LED = mk('WS2812B', 'D', 'LED_SMD:LED_WS2812B_PLCC4_5.0x5.0mm_P3.2mm',
         [(1, 'VDD', PT.PWRIN), (2, 'DOUT', PT.OUTPUT), (3, 'GND', PT.PWRIN), (4, 'DIN', PT.INPUT)],
         value='WS2812B')
D_led = LED(); D_led.ref = 'LED1'
D_led['VDD'] += P5V; D_led['GND'] += GND; D_led['DIN'] += LED_DIN   # DOUT left open

# ---- USB-C power inlet (connector optional/DNP; passives always fitted) ------
usbc = mk('USB_C_power', 'J', 'TypeC6P:TYPE-C-SMD_TYPE-C-6P_1',
          [('A9', 'VBUS', PT.PASSIVE), ('B9', 'VBUS', PT.PASSIVE),     # both sides -> reversible
           ('A12', 'GND', PT.PASSIVE), ('B12', 'GND', PT.PASSIVE),
           ('A5', 'CC1', PT.PASSIVE), ('B5', 'CC2', PT.PASSIVE),
           ('7', 'SHIELD', PT.PASSIVE)],                               # shell/mount tabs (pad 7)
          value='USB-C 6P power (TYPE-C 6P)')
J_usb = usbc(); J_usb.ref = 'J2'
J_usb['VBUS'] += VBUS; J_usb['GND'] += GND
J_usb['CC1'] += CC1; J_usb['CC2'] += CC2
J_usb['SHIELD'] += GND          # shell to GND (logic side)

Rcc1 = two('R', 'R', 'Resistor_SMD:R_0805_2012Metric', '5k1'); Rcc1.ref = 'Rcc1'
Rcc1[1] += CC1; Rcc1[2] += GND
Rcc2 = two('R', 'R', 'Resistor_SMD:R_0805_2012Metric', '5k1'); Rcc2.ref = 'Rcc2'
Rcc2[1] += CC2; Rcc2[2] += GND

F1 = two('F', 'F', 'Fuse:Fuse_1206_3216Metric', 'PTC 1A'); F1.ref = 'F1'
F1[1] += VBUS; F1[2] += VBUS_F
D2 = mk('SMAJ5.0A', 'D', 'Diode_SMD:D_SMB', [(1, 'K', PT.PASSIVE), (2, 'A', PT.PASSIVE)], value='SMAJ5.0A')
U_d2 = D2(); U_d2.ref = 'D2'
U_d2['K'] += VBUS; U_d2['A'] += GND
D3 = mk('SS34', 'D', 'Diode_SMD:D_SMA', [(1, 'K', PT.PASSIVE), (2, 'A', PT.PASSIVE)], value='SS34')
U_d3 = D3(); U_d3.ref = 'D3'
U_d3['A'] += VBUS_F; U_d3['K'] += P5V             # OR-ing diode onto 5V rail

# ---- J1  XLR-3 DMX output (female, 3-pin) — bus / GND2 domain ----------------
# 3-pin DMX: pin1 = shield/common, pin2 = Data-, pin3 = Data+.
xlr = mk('XLR3', 'J', 'XLR328P:CONN-TH_XLR-328P',
         [(1, 'SHIELD', PT.PASSIVE), (2, 'DATA-', PT.PASSIVE), (3, 'DATA+', PT.PASSIVE)],
         value='XLR-3 DMX out (XLR-328P)')
J1 = xlr(); J1.ref = 'J1'
J1['SHIELD'] += GND2         # pin 1 = shield/common (isolated bus ground)
J1['DATA-'] += DMX_B         # pin 2 = Data-
J1['DATA+'] += DMX_A         # pin 3 = Data+

ERC()
generate_netlist(file_=os.path.join(HERE, 'lumigate_carrier.net'))
print('NETLIST GENERATED OK ->', os.path.join(HERE, 'lumigate_carrier.net'))
