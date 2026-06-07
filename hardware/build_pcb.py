#!/usr/bin/env python
"""Build a populated, pre-placed lumigate_carrier.kicad_pcb from the netlist.

Runs under KiCad's bundled python (has the `pcbnew` module). Loads every
footprint, assigns nets from lumigate_carrier.net, drops each part at a sensible
grouped position, and draws a board outline. Overwrites lumigate_carrier.kicad_pcb.

Usage (KiCad 10 bundled python):
  "C:\\Program Files\\KiCad\\10.0\\bin\\python.exe" build_pcb.py
"""
import os, re, sys
import pcbnew

HERE = os.path.dirname(os.path.abspath(__file__))
NET = os.path.join(HERE, 'lumigate_carrier.net')
OUT = os.path.join(HERE, 'lumigate_carrier.kicad_pcb')
STOCK = r"C:\Program Files\KiCad\10.0\share\kicad\footprints"
LOCAL = os.path.join(HERE, 'LumiGate.pretty')

BOARD_W, BOARD_H = 135.0, 72.0

# ref -> (x_mm, y_mm, rotation_deg). Grouped: USB block left, module centre,
# logic decoupling + U2 + bus block right, XLR far right, RGB top.
PLACE = {
    'J2': (8, 40, 90),   'F1': (20, 32),  'D3': (28, 32),  'D2': (20, 48),
    'Rcc1': (20, 40),    'Rcc2': (28, 40),
    'U1': (54, 40, 0),
    'LED1': (54, 9),     'U3': (62, 11),  'C6': (46, 11),  'C7': (70, 11),
    'R6': (58, 16),
    'C5': (72, 32),      'C1': (72, 40),  'C2': (72, 48),  'R2': (76, 56),
    'U2': (84, 40, 0),
    'C3': (93, 30),      'C4': (93, 50),  'D1': (93, 40),  'R1': (101, 36),
    'JP1': (101, 46),
    'J1': (120, 40, 270),
}


def parse_netlist(path):
    txt = open(path, encoding='utf-8').read()
    comps = {}
    for ref, fp in re.findall(r'\(comp\s+\(ref "([^"]+)"\).*?\(footprint "([^"]+)"\)', txt, re.S):
        comps[ref] = fp
    padnet = {}                       # (ref, pad) -> netname
    for blk in re.split(r'\(net\s+\(code\s+\d+\)', txt)[1:]:
        name = re.search(r'\(name "([^"]*)"\)', blk)
        if not name:
            continue
        nm = name.group(1)
        for ref, pin in re.findall(r'\(node\s*\(ref "([^"]+)"\)\s*\(pin "([^"]+)"', blk):
            padnet[(ref, pin)] = nm
    return comps, padnet


def fp_path(fpid):
    lib, name = fpid.split(':', 1)
    base = LOCAL if lib == 'LumiGate' else os.path.join(STOCK, lib + '.pretty')
    return base, name


def main():
    comps, padnet = parse_netlist(NET)
    board = pcbnew.BOARD()

    # nets first
    netobjs = {'': board.GetNetInfo().GetNetItem(0)}
    for nm in sorted({n for n in padnet.values()}):
        ni = pcbnew.NETINFO_ITEM(board, nm)
        board.Add(ni)
        netobjs[nm] = ni

    placed, missing = 0, []
    for ref, fpid in comps.items():
        base, name = fp_path(fpid)
        fp = pcbnew.FootprintLoad(base, name)
        if fp is None:
            missing.append(f"{ref} ({fpid})")
            continue
        fp.SetReference(ref)
        x, y, *rot = PLACE.get(ref, (60, 62, 0))   # leftovers parked bottom-centre
        rot = rot[0] if rot else 0
        fp.SetPosition(pcbnew.VECTOR2I(pcbnew.FromMM(float(x)), pcbnew.FromMM(float(y))))
        fp.SetOrientationDegrees(rot)
        board.Add(fp)
        # assign pad nets
        for pad in fp.Pads():
            key = (ref, pad.GetNumber())
            nm = padnet.get(key)
            if nm is not None:
                pad.SetNet(netobjs[nm])
        placed += 1

    # board outline rectangle on Edge.Cuts
    rect = pcbnew.PCB_SHAPE(board)
    rect.SetShape(pcbnew.SHAPE_T_RECT)
    rect.SetStart(pcbnew.VECTOR2I(pcbnew.FromMM(0), pcbnew.FromMM(0)))
    rect.SetEnd(pcbnew.VECTOR2I(pcbnew.FromMM(BOARD_W), pcbnew.FromMM(BOARD_H)))
    rect.SetLayer(pcbnew.Edge_Cuts)
    rect.SetWidth(pcbnew.FromMM(0.15))
    board.Add(rect)

    # --- ground zones with isolation gap under U2 (logic | gap | bus) ---------
    # U2 sits at x=84 (SOIC-20W ~80.25..87.75); gap 81.5..86.5 = 5mm > 4mm barrier.
    print("adding zones...", flush=True)

    def add_zone(netname, layer, x1, y1, x2, y2):
        z = pcbnew.ZONE(board)
        z.SetLayer(layer)
        z.SetNetCode(netobjs[netname].GetNetCode())
        z.SetAssignedPriority(0)
        poly = z.Outline()
        poly.NewOutline()
        for x, y in [(x1, y1), (x2, y1), (x2, y2), (x1, y2)]:
            poly.Append(pcbnew.FromMM(x), pcbnew.FromMM(y))
        board.Add(z)

    for layer in (pcbnew.F_Cu, pcbnew.B_Cu):
        add_zone('GND',    layer, 1.0,  1.0, 81.5, BOARD_H - 1.0)   # logic side
        add_zone('GNDISO', layer, 86.5, 1.0, BOARD_W - 1.0, BOARD_H - 1.0)  # bus side
    print("zones added (unfilled - press B in KiCad to fill)", flush=True)

    pcbnew.SaveBoard(OUT, board)
    print("board saved", flush=True)
    print(f"PLACED {placed} footprints, nets={len(netobjs)-1}")
    if missing:
        print("MISSING:", "; ".join(missing))
    print("SAVED", OUT)


main()
