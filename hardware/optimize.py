#!/usr/bin/env python
"""Auto-place + auto-route + shrink loop for the LumiGate carrier.

For each candidate board size (smallest first), it: places all parts in a grouped
compact layout, builds the board (nets + ground zones with the isolation gap under
U2), autoroutes with Freerouting, refills zones, and runs DRC. The first size that
passes (no non-J2 unconnected pads, no clearance violations) wins and is written to
lumigate_carrier.kicad_pcb.

Run with KiCad 10 bundled python; needs java + freerouting 1.9.0 jar.
"""
import os, re, sys, json, subprocess, tempfile, shutil
import pcbnew

HERE = os.path.dirname(os.path.abspath(__file__))
NET = os.path.join(HERE, 'lumigate_carrier.net')
DRU = os.path.join(HERE, 'lumigate_carrier.kicad_dru')
FINAL = os.path.join(HERE, 'lumigate_carrier.kicad_pcb')
CLI = r"C:\Program Files\KiCad\10.0\bin\kicad-cli.exe"
STOCK = r"C:\Program Files\KiCad\10.0\share\kicad\footprints"
LOCAL = os.path.join(HERE, 'LumiGate.pretty')
JAR = os.environ.get('FREEROUTING_JAR', r'C:\tmp\freerouting19.jar')
PT = pcbnew.PAD_ATTRIB_PTH

# smallest first -> first pass wins. H must be tall enough for the module body
# (~52mm on-board) plus the RGB top strip; the connectors overhang the bottom edge.
SIZES = [(88, 48), (94, 50), (100, 54)]


def parse_netlist():
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


def place(W, H):
    """Grouped compact layout fitted to board WxH. Returns ref->(x,y,rot).
    Logic + bus passives sit in vertical columns either side of U2 (saves width;
    the XLR body needs the right-hand space)."""
    cy = H / 2.0
    # Compact layout. Module left-of-centre; logic caps tucked UNDER the module
    # (it floats ~8mm up on the header sockets); U2 close to EXT2; bus parts + XLR
    # on the right; USB-C + its parts in the left margin. Module RJ45/USB overhang
    # the bottom edge; module body overhangs top/bottom (board < module).
    mx = 31                  # module centre  -> EXT1 x=18.3, EXT2 x=43.7
    ux = 55                  # U2 centre (just right of EXT2); isolation gap here
    bx = ux + 9              # bus parts column
    P = {
        'J2': (10, cy, 270),
        'U1': (mx, cy, 0),
        'J1': (W - 12, cy, 0),
        'U2': (ux, cy, 0),
        # left margin column (x<17 = NOT under the module body): RGB on top so the
        # LED is VISIBLE, USB support below it
        'LED1': (12, 5), 'U3': (12, 11), 'R6': (12, 16),
        'F1': (12, 22), 'D2': (12, 28), 'D3': (12, 34), 'Rcc1': (12, 40), 'Rcc2': (12, 45),
        # logic decoupling + R2: UNDER the module (x 22..38, between the header rows)
        'C1': (23, cy - 8), 'C2': (30, cy - 8), 'C5': (37, cy - 8),
        'C6': (23, cy + 8), 'C7': (30, cy + 8), 'R2': (37, cy + 8),
        # bus-side column (right of U2)
        'C3': (bx, cy - 12), 'C4': (bx, cy - 4), 'D1': (bx, cy + 4),
        'R1': (bx, cy + 12), 'JP1': (bx + 6, cy + 12),
    }
    return P, ux


def build(W, H, comps, padnet, path):
    board = pcbnew.BOARD()
    nets = {}
    for nm in sorted(set(padnet.values())):
        ni = pcbnew.NETINFO_ITEM(board, nm)
        board.Add(ni)
        nets[nm] = ni
    P, ux = place(W, H)
    for ref, fpid in comps.items():
        lib, name = fpid.split(':', 1)
        base = LOCAL if lib == 'LumiGate' else os.path.join(STOCK, lib + '.pretty')
        fp = pcbnew.FootprintLoad(base, name)
        if fp is None:
            print("MISSING fp", fpid); continue
        fp.SetReference(ref)
        x, y, *rot = P.get(ref, (W / 2, H - 3, 0))
        fp.SetPosition(pcbnew.VECTOR2I(pcbnew.FromMM(float(x)), pcbnew.FromMM(float(y))))
        fp.SetOrientationDegrees(rot[0] if rot else 0)
        board.Add(fp)
        for pad in fp.Pads():
            nm = padnet.get((ref, pad.GetNumber()))
            if nm:
                pad.SetNet(nets[nm])
    # Board outline at x=0. J2 is positioned so its solder pads are ON the board
    # and the connector opening overhangs to the left (standard edge-mount style).
    rect = pcbnew.PCB_SHAPE(board); rect.SetShape(pcbnew.SHAPE_T_RECT)
    rect.SetStart(pcbnew.VECTOR2I(0, 0))
    rect.SetEnd(pcbnew.VECTOR2I(pcbnew.FromMM(W), pcbnew.FromMM(H)))
    rect.SetLayer(pcbnew.Edge_Cuts); rect.SetWidth(pcbnew.FromMM(0.15))
    board.Add(rect)
    # ground zones with gap under U2
    def zone(netname, x1, y1, x2, y2):
        for layer in (pcbnew.F_Cu, pcbnew.B_Cu):
            z = pcbnew.ZONE(board); z.SetLayer(layer)
            z.SetNetCode(nets[netname].GetNetCode())
            poly = z.Outline(); poly.NewOutline()
            for x, y in [(x1, y1), (x2, y1), (x2, y2), (x1, y2)]:
                poly.Append(pcbnew.FromMM(x), pcbnew.FromMM(y))
            board.Add(z)
    zone('GND', 1, 1, ux - 2.5, H - 1)
    zone('GNDISO', ux + 2.5, 1, W - 1, H - 1)
    pcbnew.SaveBoard(path, board)


def route(path):
    dsn = path.replace('.kicad_pcb', '.dsn'); ses = path.replace('.kicad_pcb', '.ses')
    b = pcbnew.LoadBoard(path)
    pcbnew.ExportSpecctraDSN(b, dsn)
    subprocess.run(['java', '-jar', JAR, '-de', dsn, '-do', ses, '-mp', '15'],
                   capture_output=True, text=True, timeout=300)
    if not os.path.exists(ses):
        return False
    b = pcbnew.LoadBoard(path)
    pcbnew.ImportSpecctraSES(b, ses)
    pcbnew.ZONE_FILLER(b).Fill(b.Zones())
    pcbnew.SaveBoard(path, b)
    return True


def drc_ok(path):
    shutil.copy(DRU, path.replace('.kicad_pcb', '.kicad_dru'))
    rpt = path.replace('.kicad_pcb', '.drc.json')
    subprocess.run([CLI, 'pcb', 'drc', '--format', 'json', '-o', rpt, path],
                   capture_output=True, text=True)
    d = json.load(open(rpt, encoding='utf-8'))
    unconn, clr, hard = 0, 0, 0
    for v in d.get('violations', []):
        items = ' '.join(i.get('description', '') for i in v.get('items', []))
        t = v['type']
        if t == 'unconnected_items':
            if 'J2' not in items:
                unconn += 1
        elif t == 'clearance':
            clr += 1
        elif t == 'shorting_items':
            hard += 1
        elif t == 'courtyards_overlap':
            # SMD tucked under the module is fine (module floats on header sockets)
            if 'U1' not in items:
                hard += 1
    return unconn, clr, hard


def main():
    comps, padnet = parse_netlist()
    tmp = os.path.join(tempfile.gettempdir(), 'lg_opt.kicad_pcb')
    best = None
    for (W, H) in SIZES:
        print(f"\n=== trying {W} x {H} mm (area {W*H}) ===", flush=True)
        build(W, H, comps, padnet, tmp)
        if not route(tmp):
            print("  routing failed"); continue
        unconn, clr, hard = drc_ok(tmp)
        print(f"  non-J2 unconnected={unconn}  clearance={clr}  shorts/overlaps={hard}", flush=True)
        if unconn == 0 and clr == 0 and hard == 0:
            best = (W, H)
            shutil.copy(tmp, FINAL)
            print(f"  >>> PASS, saved {W}x{H} as final", flush=True)
            break
    if not best:
        print("\nNo size passed; widen SIZES or relax spacing.")
    else:
        print(f"\nSMALLEST WORKING BOARD: {best[0]} x {best[1]} mm -> {FINAL}")


if __name__ == '__main__':
    main()
