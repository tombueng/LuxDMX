#!/usr/bin/env python
"""Curated (hand-laid-out) KiCad schematic for the LumiGate carrier.

Left->right signal flow: USB-C power -> ESP module -> ADM2587E -> XLR, RGB on top.
Power/GND as power symbols, signal paths as drawn wires, DMX bus nets as labels.
Only the actually-connected pins are shown (module/USB-C simplified).
"""
import os, uuid

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'lumigate_carrier_schematic.kicad_sch')
P = 2.54
L = 3.81          # pin stub length

def U():
    return str(uuid.uuid4())

# ---- component definitions -------------------------------------------------
# ref: (value, center_x, center_y, width, [left pins top->bottom], [right pins top->bottom])
# a pin = (label_shown, netname)
C = {
 'J2': ('USB-C', 40, 120, 16, [], [('VBUS','VBUS_C'),('GND','GND'),('CC1','CC1'),('CC2','CC2')]),
 'F1': ('PTC 1A', 72, 92, 8, [('1','VBUS_C')], [('2','VBUS_FUSED')]),
 'D3': ('SS34', 96, 92, 8, [('A','VBUS_FUSED')], [('K','+5V')]),
 'D2': ('SMAJ5.0A', 72, 110, 8, [('K','VBUS_C')], [('A','GND')]),
 'Rcc1': ('5k1', 72, 132, 8, [('1','CC1')], [('2','GND')]),
 'Rcc2': ('5k1', 72, 146, 8, [('1','CC2')], [('2','GND')]),
 'U1': ('ESP32-POE-ISO', 130, 120, 30,
        [('+5V','+5V'),('+3V3','+3V3'),('GND','GND')],
        [('GPIO4','DMX_TX'),('GPIO36','DMX_RX'),('GPIO32','DMX_EN'),('GPIO33','RGB_DIN')]),
 'U2': ('ADM2587E', 215, 120, 30,
        [('VDD','+3V3'),('TxD','DMX_TX'),('RxD','DMX_RX'),('DE','DMX_EN'),('/RE','DMX_EN'),('GND1','GND')],
        [('VISOOUT','VISO'),('VISOIN','VISO'),('A','DMX_A'),('Y','DMX_A'),('B','DMX_B'),('Z','DMX_B'),('GND2','GNDISO')]),
 'J1': ('XLR-5', 305, 112, 16,
        [('3 D+','DMX_A'),('2 D-','DMX_B'),('1 SH','GNDISO'),('G','GNDISO')], []),
 'U3': ('74LVC1G125', 205, 55, 20, [('A','RGB_DIN'),('OE','GND')], [('Y','RGB_DIN_5V'),('VCC','+5V'),('GND','GND')]),
 'R6': ('330R', 245, 50, 8, [('1','RGB_DIN_5V')], [('2','LED_DIN')]),
 'LED1': ('WS2812B', 278, 52, 14, [('DIN','LED_DIN')], [('VDD','+5V'),('GND','GND')]),
 'D1': ('SM712', 268, 165, 10, [('A','DMX_A'),('GND','GNDISO')], [('B','DMX_B')]),
 'R1': ('120R', 250, 145, 8, [('1','DMX_A')], [('2','DMX_A_TERM')]),
 'JP1': ('TERM', 275, 145, 8, [('1','DMX_A_TERM')], [('2','DMX_B')]),
 'C1': ('100nF', 175, 150, 7, [], [('1','+3V3'),('2','GND')]),
 'C2': ('10uF', 175, 162, 7, [], [('1','+3V3'),('2','GND')]),
 'C5': ('100nF', 175, 174, 7, [], [('1','+3V3'),('2','GND')]),
 'C3': ('100nF', 255, 185, 7, [], [('1','VISO'),('2','GNDISO')]),
 'C4': ('10uF', 270, 185, 7, [], [('1','VISO'),('2','GNDISO')]),
 'C6': ('100nF', 300, 78, 7, [], [('1','+5V'),('2','GND')]),
 'C7': ('100nF', 168, 78, 7, [], [('1','+5V'),('2','GND')]),
}

PWR = {'GND','GNDISO','+3V3','+5V','VISO'}
LABEL_NETS = {'DMX_A','DMX_B'}          # multi-node bus -> labels (clean)

# compute pin endpoint coordinates and collect net -> [(x,y,angle_out)]
endpoints = {}   # (ref,label) -> (x,y, side)
def add_endpoints(ref):
    val,cx,cy,w,lp,rp = C[ref]
    def col(pins, side):
        n=len(pins)
        for i,(lbl,net) in enumerate(pins):
            y = cy - (n-1)*P/2 + i*P
            x = cx - w/2 - L if side=='L' else cx + w/2 + L
            endpoints[(ref,lbl)] = (x,y,side,net)
    col(lp,'L'); col(rp,'R')
for r in C: add_endpoints(r)

# ---- emit ------------------------------------------------------------------
out=['(kicad_sch (version 20250114) (generator "lumigate") (generator_version "9.0")',
     f'  (uuid "{U()}")','  (paper "A3")']
libs=['  (lib_symbols']
body=[]
pwrn=[0]

def comp_symbol(ref):
    val,cx,cy,w,lp,rp = C[ref]
    nmax=max(len(lp),len(rp),1); h=(nmax-1)*P+2*P
    libid=f"lg:{ref}"
    s=[f'    (symbol "{libid}" (pin_names (offset 1.016)) (exclude_from_sim no) (in_bom yes) (on_board yes)',
       f'      (property "Reference" "{ref}" (at {-w/2:.2f} {h/2+1.5:.2f} 0) (effects (font (size 1.27 1.27)) (justify left)))',
       f'      (property "Value" "{val}" (at {-w/2:.2f} {-h/2-1.5:.2f} 0) (effects (font (size 1.0 1.0)) (justify left)))',
       f'      (symbol "{ref}_0_1" (rectangle (start {-w/2:.2f} {h/2:.2f}) (end {w/2:.2f} {-h/2:.2f}) (stroke (width 0.15) (type default)) (fill (type background))))',
       f'      (symbol "{ref}_1_1"']
    def pins(plist, side):
        n=len(plist)
        for i,(lbl,net) in enumerate(plist):
            y = (n-1)*P/2 - i*P
            if side=='L':
                x=-w/2-L; ang=0
            else:
                x=w/2+L; ang=180
            s.append(f'        (pin passive line (at {x:.2f} {y:.2f} {ang}) (length {L}) '
                     f'(name "{lbl}" (effects (font (size 1.0 1.0)))) (number "{i+1}{side}" (effects (font (size 0.7 0.7)))))')
    pins(lp,'L'); pins(rp,'R')
    s+=['      )','    )']
    return s

for r in C: libs+=comp_symbol(r)

# power symbol defs
def pdef(net):
    safe=net.replace('+','p'); ground='GND' in net
    g=('        (polyline (pts (xy -1.27 -1.27)(xy 1.27 -1.27)(xy 0 -2.54)(xy -1.27 -1.27)) (stroke (width 0.2)(type default))(fill (type none)))'
       if ground else
       '        (polyline (pts (xy -1.27 1.27)(xy 1.27 1.27)) (stroke (width 0.2)(type default))(fill (type none)))')
    return [f'    (symbol "pwr:{safe}" (power)(pin_names (offset 0))(exclude_from_sim no)(in_bom no)(on_board yes)',
            f'      (property "Reference" "#PWR" (at 0 0 0)(effects (font (size 1.27 1.27))(hide yes)))',
            f'      (property "Value" "{net}" (at 0 {2.0 if not ground else -3.5} 0)(effects (font (size 1.0 1.0))))',
            f'      (symbol "{safe}_0_1"',g,'      )',
            f'      (symbol "{safe}_1_1" (pin power_in line (at 0 0 90)(length 0)(name "{net}"(effects(font(size 1.0 1.0))))(number "1"(effects(font(size 1.0 1.0))))))',
            '    )']
for net in sorted(PWR): libs+=pdef(net)
libs.append('  )')

# component instances
for r in C:
    val,cx,cy,w,lp,rp=C[r]
    nmax=max(len(lp),len(rp),1); h=(nmax-1)*P+2*P
    inst=[f'  (symbol (lib_id "lg:{r}") (at {cx:.2f} {cy:.2f} 0) (unit 1)(exclude_from_sim no)(in_bom yes)(on_board yes)(dnp no)',
          f'    (uuid "{U()}")',
          f'    (property "Reference" "{r}" (at {cx-w/2:.2f} {cy-h/2-1.5:.2f} 0)(effects (font (size 1.27 1.27))(justify left)))',
          f'    (property "Value" "{val}" (at {cx-w/2:.2f} {cy+h/2+1.5:.2f} 0)(effects (font (size 1.0 1.0))(justify left)))']
    k=1
    for (lbl,net) in lp+rp:
        side='L' if (lbl,net) in lp else 'R'
    # pin instances (numbers must match lib: i+1 + side)
    for i,(lbl,net) in enumerate(lp): inst.append(f'    (pin "{i+1}L" (uuid "{U()}"))')
    for i,(lbl,net) in enumerate(rp): inst.append(f'    (pin "{i+1}R" (uuid "{U()}"))')
    inst.append(f'    (instances (project "lumigate_carrier" (path "/" (reference "{r}")(unit 1))))')
    inst.append('  )')
    body+=inst

def wire(x1,y1,x2,y2):
    body.append(f'  (wire (pts (xy {x1:.2f} {y1:.2f})(xy {x2:.2f} {y2:.2f})) (stroke (width 0.15)(type default)) (uuid "{U()}"))')

def manhattan(a,b):
    (x1,y1,s1,_),(x2,y2,s2,_)=a,b
    mx=(x1+x2)/2
    wire(x1,y1,mx,y1); wire(mx,y1,mx,y2); wire(mx,y2,x2,y2)

def power_at(x,y,net,side):
    safe=net.replace('+','p'); pwrn[0]+=1
    ang = 270 if side=='L' else 90
    body.extend([f'  (symbol (lib_id "pwr:{safe}")(at {x:.2f} {y:.2f} {ang})(unit 1)(exclude_from_sim no)(in_bom no)(on_board yes)(dnp no)',
        f'    (uuid "{U()}")',
        f'    (property "Reference" "#PWR{pwrn[0]:03d}"(at {x:.2f} {y:.2f} 0)(effects(font(size 1.27 1.27))(hide yes)))',
        f'    (property "Value" "{net}"(at {x:.2f} {y:.2f} 0)(effects(font(size 1.0 1.0))(hide yes)))',
        f'    (pin "1"(uuid "{U()}"))',
        f'    (instances (project "lumigate_carrier"(path "/"(reference "#PWR{pwrn[0]:03d}")(unit 1))))','  )'])

def label_at(x,y,net,side):
    ang = 0 if side=='R' else 180
    just = 'left' if side=='R' else 'right'
    body.append(f'  (global_label "{net}"(shape input)(at {x:.2f} {y:.2f} {ang})(fields_autoplaced yes)'
                f'(effects(font(size 1.0 1.0))(justify {just}))(uuid "{U()}"))')

# group endpoints by net
nets={}
for (ref,lbl),(x,y,side,net) in endpoints.items():
    nets.setdefault(net,[]).append((x,y,side,ref,lbl))

for net,nodes in nets.items():
    if net in PWR:
        for (x,y,side,ref,lbl) in nodes: power_at(x,y,net,side)
    elif net in LABEL_NETS:
        for (x,y,side,ref,lbl) in nodes: label_at(x,y,net,side)
    else:
        # draw as chain of manhattan wires
        ns=sorted(nodes,key=lambda n:(n[0],n[1]))
        for i in range(len(ns)-1):
            a=(ns[i][0],ns[i][1],ns[i][2],net); b=(ns[i+1][0],ns[i+1][1],ns[i+1][2],net)
            manhattan(a,b)

out+=libs; out+=body
out.append('  (sheet_instances (path "/" (page "1")))')
out.append(')')
open(OUT,'w',encoding='utf-8').write('\n'.join(out)+'\n')
print('WROTE',OUT)
