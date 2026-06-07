#!/usr/bin/env python
"""Build the carrier as module-width (28.25mm), U1 aligned to the Olimex module.

Layout (portrait, top-left origin):
  top strip   : LED (visible, logic side), RGB driver
  module      : U1 socket, RJ45 overhangs TOP edge
  bus bottom  : U2 bus side, D1, termination, XLR overhangs BOTTOM edge
  left edge   : USB-C
Isolation gap horizontal between module/logic (top) and bus (bottom).
"""
import os, re, subprocess, tempfile
import pcbnew

HERE = os.path.dirname(os.path.abspath(__file__))
NET = os.path.join(HERE, 'lumigate_carrier.net')
PCB = os.path.join(HERE, 'lumigate_carrier.kicad_pcb')
STOCK = r"C:\Program Files\KiCad\10.0\share\kicad\footprints"
LOCAL = os.path.join(HERE, 'LumiGate.pretty')

W, H = 28.25, 75.0
# U1 rot 180 so the module RJ45 overhangs the TOP edge. EXT is 17.15mm from the
# RJ45 end -> place EXT at y=17.15 so RJ45 PCB edge sits at the top edge.
# Module PCB then covers y 0..56.6; the strip below (56.6..75) is module-free:
# LED/RGB just below the module (visible, logic), then the isolation gap, then XLR.
U1X, U1Y, U1ROT = 13.94, 17.15, 180
GAPY = 64.0          # isolation gap (logic above, bus below)


def parse():
    txt = open(NET, encoding='utf-8').read()
    comps = {}
    for ref, fp in re.findall(r'\(comp\s+\(ref "([^"]+)"\).*?\(footprint "([^"]+)"\)', txt, re.S):
        comps[ref] = fp
    padnet = {}
    for blk in re.split(r'\(net\s+\(code\s+\d+\)', txt)[1:]:
        nm = re.search(r'\(name "([^"]*)"\)', blk)
        if not nm:
            continue
        for ref, pin in re.findall(r'\(node\s*\(ref "([^"]+)"\)\s*\(pin "([^"]+)"', blk):
            padnet[(ref, pin)] = nm.group(1)
    return comps, padnet


# ref -> (x, y, rot)
PLACE = {
    'U1': (U1X, U1Y, U1ROT),                 # module socket, RJ45 overhangs top
    # logic decoupling UNDER the module (module floats on sockets) — logic region
    'C1': (5, 24, 0), 'C2': (23, 24, 0), 'C5': (5, 34, 0),
    'C6': (23, 34, 0), 'C7': (5, 44, 0), 'R2': (23, 44, 0),
    # USB-C left edge + support (logic, under module)
    'J2': (4, 30, 270), 'F1': (24, 14, 0), 'D2': (24, 20, 0),
    'D3': (24, 50, 0), 'Rcc1': (5, 14, 0), 'Rcc2': (5, 54, 0),
    # RGB just BELOW the module (visible strip, logic side, above the gap)
    'LED1': (7, 59, 0), 'U3': (15, 59, 0), 'R6': (22, 59, 0),
    # U2 at the gap: bus pins point down (toward XLR), logic pins up (toward module)
    'U2': (14, 64, 90),
    # bus parts (below gap, isolated)
    'C3': (4, 69, 0), 'C4': (9, 69, 0), 'D1': (14, 69, 0),
    'R1': (19, 69, 0), 'JP1': (24, 69, 0),
    # XLR DMX out, overhangs bottom edge
    'J1': (14, 73, 0),
}


def build():
    comps, padnet = parse()
    b = pcbnew.BOARD()
    nets = {}
    for nm in sorted(set(padnet.values())):
        ni = pcbnew.NETINFO_ITEM(b, nm); b.Add(ni); nets[nm] = ni
    for ref, fpid in comps.items():
        lib, name = fpid.split(':', 1)
        base = LOCAL if lib == 'LumiGate' else os.path.join(STOCK, lib + '.pretty')
        fp = pcbnew.FootprintLoad(base, name)
        if fp is None:
            print("MISSING", fpid); continue
        fp.SetReference(ref)
        x, y, rot = PLACE.get(ref, (14, H - 3, 0))
        fp.SetPosition(pcbnew.VECTOR2I(pcbnew.FromMM(x), pcbnew.FromMM(y)))
        fp.SetOrientationDegrees(rot)
        b.Add(fp)
        for pad in fp.Pads():
            nm = padnet.get((ref, pad.GetNumber()))
            if nm:
                pad.SetNet(nets[nm])
    # outline
    r = pcbnew.PCB_SHAPE(b); r.SetShape(pcbnew.SHAPE_T_RECT)
    r.SetStart(pcbnew.VECTOR2I(0, 0)); r.SetEnd(pcbnew.VECTOR2I(pcbnew.FromMM(W), pcbnew.FromMM(H)))
    r.SetLayer(pcbnew.Edge_Cuts); r.SetWidth(pcbnew.FromMM(0.15)); b.Add(r)
    # zones: logic (top) GND, bus (bottom) GNDISO, gap at GAPY
    def zone(net, y1, y2):
        for layer in (pcbnew.F_Cu, pcbnew.B_Cu):
            z = pcbnew.ZONE(b); z.SetLayer(layer); z.SetNetCode(nets[net].GetNetCode())
            poly = z.Outline(); poly.NewOutline()
            for x, y in [(0.5, y1), (W - 0.5, y1), (W - 0.5, y2), (0.5, y2)]:
                poly.Append(pcbnew.FromMM(x), pcbnew.FromMM(y))
            b.Add(z)
    zone('GND', 0.5, GAPY - 2.5)
    zone('GNDISO', GAPY + 2.5, H - 0.5)
    # attach Olimex 3D model to U1 (Z up, aligned)
    u1 = b.FindFootprintByReference("U1")
    m = pcbnew.FP_3DMODEL(); m.m_Filename = "${KIPRJMOD}/3d/ESP32-POE-ISO_full.step"
    m.m_Offset = pcbnew.VECTOR3D(0, 0, 8.5); m.m_Rotation = pcbnew.VECTOR3D(0, 0, 0)
    m.m_Scale = pcbnew.VECTOR3D(1, 1, 1); u1.Models().push_back(m)
    pcbnew.SaveBoard(PCB, b)
    print(f"Built {W}x{H}mm aligned board")


build()
