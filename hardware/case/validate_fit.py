#!/usr/bin/env python
"""Validate the enclosure against the live PCB.

Cross-checks the OpenSCAD design parameters (board_params.scad + lumigate_case.scad)
against geometry parsed straight from lumigate.kicad_pcb:

  * the PCB outline + ESP32 overhang fit inside the interior cavity
  * every connector courtyard is covered by its wall opening (with clearance)
  * the 5 LED light holes sit over the LEDs
  * the 4 corner ears and the board snap-clamps clear all component courtyards
  * the cover is tall enough for the tallest declared component

Exit code 0 = all checks pass.  Run after editing the board or the case.
"""
import math, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
PCB  = os.path.join(HERE, "..", "lumigate.kicad_pcb")

# ----------------------------------------------------------- read .scad params
def scad_params(*files):
    p = {}
    for fn in files:
        for line in open(os.path.join(HERE, fn), encoding="utf-8"):
            m = re.match(r'\s*([A-Za-z_]\w*)\s*=\s*([-\d.]+)\s*;', line)
            if m:
                try: p[m.group(1)] = float(m.group(2))
                except ValueError: pass
            m = re.match(r'\s*([A-Za-z_]\w*)\s*=\s*\[([-\d., ]+)\]\s*;', line)
            if m:
                p[m.group(1)] = [float(x) for x in m.group(2).split(',') if x.strip()]
            m = re.match(r'\s*([A-Za-z_]\w*)\s*=\s*(true|false)\s*;', line)
            if m:
                p[m.group(1)] = (m.group(2) == 'true')
    return p

P = scad_params("board_params.scad", "lumigate_case.scad")

# ----------------------------------------------------------- minimal pcb parser
def parse(s):
    n=len(s)
    def rd(i):
        out=[]
        while i<n:
            c=s[i]
            if c=='(': sub,i=rd(i+1); out.append(sub)
            elif c==')': return out,i+1
            elif c.isspace(): i+=1
            elif c=='"':
                j=i+1;b=[]
                while j<n and s[j]!='"':
                    if s[j]=='\\': b.append(s[j+1]); j+=2
                    else: b.append(s[j]); j+=1
                out.append('"'+''.join(b)); i=j+1
            else:
                j=i
                while j<n and not s[j].isspace() and s[j] not in '()': j+=1
                out.append(s[i:j]); i=j
        return out,i
    return rd(1)[0]

tree=parse(open(PCB,encoding="utf-8").read())
def nm(x): return x[0] if x and isinstance(x[0],str) else None
def gv(x,k):
    for c in x:
        if isinstance(c,list) and nm(c)==k: return c
    return None
def st(x): return x[1:] if isinstance(x,str) and x.startswith('"') else x
fps=[c for c in tree if isinstance(c,list) and nm(c)=='footprint']
def refof(f):
    for c in f:
        if isinstance(c,list) and nm(c)=='property' and st(c[1])=='Reference': return st(c[2])
def atof(f):
    a=gv(f,'at'); return float(a[1]),float(a[2]),(float(a[3]) if len(a)>3 else 0.0)
def xf(px,py,a,lx,ly):
    r=math.radians(a); return (px+lx*math.cos(r)+ly*math.sin(r), py-lx*math.sin(r)+ly*math.cos(r))

# board outline
gr=[c for c in tree if isinstance(c,list) and nm(c)=='gr_rect' and gv(c,'layer') and st(gv(c,'layer')[1])=='Edge.Cuts'][0]
a,b=gv(gr,'start'),gv(gr,'end')
ORIGX,ORIGY=min(float(a[1]),float(b[1])),min(float(a[2]),float(b[2]))
def U(x): return x-ORIGX
def V(y): return y-ORIGY

def outline(f, layers):
    px,py,ang=atof(f); xs=[];ys=[]
    for c in f:
        if isinstance(c,list) and nm(c) in ('fp_line','fp_rect','fp_poly'):
            lay=gv(c,'layer')
            if lay and st(lay[1]) in layers:
                for s_ in c:
                    if isinstance(s_,list) and nm(s_) in ('start','end','center','xy'):
                        bx,by=xf(px,py,ang,float(s_[1]),float(s_[2])); xs.append(U(bx));ys.append(V(by))
    return (min(xs),min(ys),max(xs),max(ys)) if xs else None

def courtyard(f):
    return outline(f,('F.CrtYd','B.CrtYd')) or outline(f,('F.Fab','B.Fab'))

def body(f):   # physical body (Fab/Silk) - excludes RF keep-out courtyards
    return outline(f,('F.Fab','B.Fab')) or outline(f,('F.SilkS','B.SilkS')) or courtyard(f)

comps      ={refof(f):courtyard(f) for f in fps if refof(f)}   # for wall openings
comps_body ={refof(f):body(f)      for f in fps if refof(f)}   # for internal-feature clearance

# ----------------------------------------------------------- derived case geom
clr=P['clr']; wall=P['wall']
ix0=-(P['esp_overhang_left']+P['esp_clr']); ix1=P['board_w']
iy0=-clr; iy1=P['board_h']+clr
split=P['standoff_h']+P['board_th']; ceil_z=split+P['cav_h']
# tallest physical component above the board top, measured from the populated GLB
TALLEST_REAL = 28.4   # XLR barrel top (measure_connectors.py)

PASS=[]; FAIL=[]; WARN=[]
def chk(cond,msg,warn=False):
    (PASS if cond else (WARN if warn else FAIL)).append(("OK " if cond else ("WARN" if warn else "FAIL"))+" | "+msg)

# 1. board + ESP32 inside the interior cavity
bb_all=[U(0)+ORIGX-ORIGX,0]  # board is 0..board_w, 0..board_h
chk(ix0 <= -P['esp_overhang_left']-0.5, f"left cavity {ix0:.2f} encloses ESP32 overhang -{P['esp_overhang_left']:.2f} (>=0.5mm clear)")
chk(iy0 <= -clr+1e-6 and iy1 >= P['board_h']+clr-1e-6, f"top/bottom cavity brackets the board with {clr}mm clr")
chk(ix1 >= P['board_w']-1e-6, f"right wall at board edge {ix1:.2f} = XLR flange plane")

# 2. connector openings vs courtyards (board-local). overhang past edge is expected.
# XLR round hole covers the barrel cross-section
xc=comps['J1']
chk(abs(P['xlr_axis_v']-(xc[1]+xc[3])/2) < 6, f"XLR hole y {P['xlr_axis_v']:.1f} near J1 courtyard centre {(xc[1]+xc[3])/2:.1f}")
# XLR datasheet panel cut-out diameter (= 22mm)
chk(19.0 <= P['xlr_hole_dia'] <= 24.0, f"XLR hole dia {P['xlr_hole_dia']}mm matches datasheet (~22mm)")
chk(11.5 <= P['xlr_axis_z'] <= 14.5, f"XLR hole centre z={P['xlr_axis_z']}mm near real barrel cz 13.05")
# flange screws (datasheet diagonal): must be OUTSIDE the barrel hole circle (fail).
# The lower screw may fall in the assembly relief (the slot below the hole that lets a
# PCB-mounted barrel drop in) - that's a known trade-off, reported as a warning.
import math as _m
sr = P['xlr_hole_dia']/2; soff = P['xlr_screw_off']; scz = P.get('xlr_screw_cz', P['xlr_axis_z'])
sdiag = P.get('xlr_screw_diag', 0)
for s in (-1, 1):
    sv = P['xlr_axis_v'] + s*soff
    sz = scz + s*sdiag*soff
    in_hole   = _m.hypot(sv-P['xlr_axis_v'], sz-P['xlr_axis_z']) < sr + 0.3
    in_relief = P.get('xlr_relief') and abs(sv-P['xlr_axis_v']) < sr and -0.5 <= sz <= P['xlr_axis_z']
    chk(not in_hole, f"XLR screw v={sv:.1f} z+{sz:.1f} outside the Ø{P['xlr_hole_dia']} barrel hole")
    if in_relief and not in_hole:
        chk(False, f"XLR lower screw v={sv:.1f} sits in the assembly relief (relief is ON) - only the upper screw is solid", warn=True)
    chk(xc[1]-1 <= sv <= xc[3]+1, f"XLR screw v={sv:.1f} on the flange [{xc[1]:.1f},{xc[3]:.1f}]")
# PUSH latch slot present + tall enough for the real latch (+28.3)
chk(P.get('xlr_push_top',0) >= 28.0, f"XLR PUSH slot top {P.get('xlr_push_top')}mm clears the latch (+28.3)")
# RJ45 opening: snug to the real face (~16.3mm at the wall), still covering the courtyard body
rj=comps['J3']; rj_w=P['rj45_open_w']
chk(16.3 <= rj_w <= 18.0, f"RJ45 opening width {rj_w}mm snug to real face ~16.3mm")
chk(P['rj45_center_v']-rj_w/2 <= rj[1]+0.6 and P['rj45_center_v']+rj_w/2 >= rj[3]-0.6,
    f"RJ45 opening (w {rj_w:.1f}, c{P['rj45_center_v']:.1f}) brackets J3 v-span [{rj[1]:.1f},{rj[3]:.1f}]")
# USB-C opening covers J2 span in u
ub=comps['J2']; ub_w=P['usbc_open_w']
chk(P['usbc_center_u']-ub_w/2 <= ub[0]+0.6 and P['usbc_center_u']+ub_w/2 >= ub[2]-0.6,
    f"USB-C opening (w {ub_w:.1f}) covers J2 u-span [{ub[0]:.1f},{ub[2]:.1f}]")

# 3. LED windows aligned with the LEDs (front side wall)
def overlaps(a,b): return b and not (a[2]<b[0] or a[0]>b[2] or a[3]<b[1] or a[1]>b[3])
for i,(ref) in enumerate(['D2','D3','D4','D5','D6']):
    c=comps[ref]; cu=(c[0]+c[2])/2
    chk(abs(P['led_u'][i]-cu) < 0.6, f"LED window {i} aligned with {ref} (du={abs(P['led_u'][i]-cu):.2f})")
chk(P['led_v'] < 5.0, f"LEDs (v={P['led_v']:.1f}) close to the front wall -> side windows visible")

# 4. snap clamps clear of component bodies (hook only reaches clamp_catch onto the board)
bh=P['board_h']; reach=P['clamp_catch']+0.6
clamp_zones=[(28-3.5,-1,28+3.5,reach),(51-3.5,-1,51+3.5,reach),
             (20-3.5,bh-reach,20+3.5,bh+1),(46-3.5,bh-reach,46+3.5,bh+1)]
chit=[r for r,c in comps_body.items() if any(overlaps(z,c) for z in clamp_zones)]
chk(not chit, "snap clamps clear of component bodies" + (f" (review {chit})" if chit else ""), warn=bool(chit))

# 5. cover height clears the tallest REAL component (the XLR), not just the openings
chk(P['cav_h'] >= TALLEST_REAL+0.5, f"cavity {P['cav_h']}mm clears tallest real part {TALLEST_REAL}mm (XLR)")

# 6. flush snap-fit closure sanity
lap_z = P['standoff_h'] + P['board_th'] - P['lap_h']
chk(lap_z > 0.5, f"snap lap bottom z={lap_z:.2f} stays above the floor")
chk('ear_off' not in P, "no external screw ears (flush, straight exterior)")

# 7. DROP-IN PATH clear for overhanging connectors (board lowers straight down)
# USB-C overhangs the back edge; its underside is +0.05mm above the board top, so the
# base back-wall top must be dropped below it.  Clearance = usbc_drop + 0.05.
usbc_bottom = 0.05          # real (measure_connectors.py): USB-C face from +0.05mm
chk(P['usbc_drop'] + usbc_bottom >= 1.0,
    f"USB-C drop-in clearance {P['usbc_drop']+usbc_bottom:.2f}mm (back wall lowered {P['usbc_drop']}mm)")
# no board snap-clamp may sit in the USB-C insertion column
ub=comps['J2']; cw=P['clamp_w']/2 + 0.5
yhi_clamps=[20, 46]        # bottom-edge clamp u-positions (keep in sync with the .scad)
clash=[u for u in yhi_clamps if (u-cw) <= ub[2] and (u+cw) >= ub[0]]
chk(not clash, "no snap clamp blocks the USB-C insertion path"+(f" (clash at u={clash})" if clash else ""))
# ESP32 module overhangs the left; recess the base block under it
chk(P['esp_drop'] >= 1.0, f"ESP32 drop-in clearance {P['esp_drop']}mm (left block recessed)")

# 8. all outer edges rounded
chk(P.get('edge_r',0) >= 1.5, f"outer edges rounded r={P.get('edge_r')}mm")

# ----------------------------------------------------------- report
print(f"Board {P['board_w']:.1f} x {P['board_h']:.1f} mm   outer "
      f"{(ix1-ix0)+2*wall:.1f} x {(iy1-iy0)+2*wall:.1f} x {ceil_z+P['ceil_th']+P['floor_th']:.1f} mm")
for s in PASS: print("  "+s)
for s in WARN: print("  "+s)
for s in FAIL: print("  "+s)
print(f"\n{len(PASS)} pass, {len(WARN)} warn, {len(FAIL)} fail")
sys.exit(1 if FAIL else 0)
