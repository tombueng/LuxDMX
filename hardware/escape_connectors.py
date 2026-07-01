import pcbnew, math
PCB=r"C:\dev\DMX\hardware\luxdmx.kicad_pcb"; FM=pcbnew.FromMM; TM=pcbnew.ToMM
b=pcbnew.LoadBoard(PCB)
# gather ALL pad data BEFORE any mutation
pads=[]
for fp in b.GetFootprints():
    fc=fp.GetPosition(); fcx,fcy=TM(fc.x),TM(fc.y)
    for pad in fp.Pads():
        bb=pad.GetBoundingBox(); pc=pad.GetPosition()
        pads.append(dict(net=pad.GetNetCode(),cx=TM(pc.x),cy=TM(pc.y),
                         r=(TM(bb.GetLeft()),TM(bb.GetTop()),TM(bb.GetRight()),TM(bb.GetBottom())),
                         ref=fp.GetReference(),pn=pad.GetNumber(),fcx=fcx,fcy=fcy,
                         onF=pad.IsOnLayer(pcbnew.F_Cu)))
for t in list(b.GetTracks()):
    if not t.IsLocked(): b.Remove(t)             # clear unlocked; KEEP locked (rebuild_iso stitch vias)
def ptr(px,py,r): dx=max(r[0]-px,0,px-r[2]); dy=max(r[1]-py,0,py-r[3]); return math.hypot(dx,dy)
placed=[]   # (x,y,netcode) of escape vias already dropped this run
def escape(ref,pn):
    tgt=next((p for p in pads if p['ref']==ref and p['pn']==pn),None)
    if not tgt: print(f"  !! {ref}.{pn} not found"); return
    nc=tgt['net']; others=[p['r'] for p in pads if p['net']!=nc]
    x,y=tgt['cx'],tgt['cy']
    ang=math.atan2(y-tgt['fcy'],x-tgt['fcx']) if (x-tgt['fcx'] or y-tgt['fcy']) else 0
    # keep >=0.45mm clear of other-net pads AND >=0.75mm centre spacing from other-net escape vias
    def vok(vx,vy):
        if not all(ptr(vx,vy,r)>=0.45 for r in others): return False
        return all(nc2==nc or math.hypot(vx-px,vy-py)>=0.75 for px,py,nc2 in placed)
    def sok(x0,y0,x1,y1):
        for i in range(11):
            t=i/10.0; px=x0+(x1-x0)*t; py=y0+(y1-y0)*t
            if any(ptr(px,py,r)<0.26 for r in others): return False
            if any(nc2!=nc and math.hypot(px-vx,py-vy)<0.45 for vx,vy,nc2 in placed): return False
        return True
    for dd in [0.7+k*0.2 for k in range(20)]:
        for da in [k*0.25 for k in range(-9,10)]:
            vx,vy=x+dd*math.cos(ang+da),y+dd*math.sin(ang+da)
            if vok(vx,vy) and sok(x,y,vx,vy):
                v=pcbnew.PCB_VIA(b); v.SetPosition(pcbnew.VECTOR2I(FM(vx),FM(vy))); v.SetViaType(pcbnew.VIATYPE_THROUGH)
                v.SetDrill(FM(0.2)); v.SetWidth(FM(0.5)); v.SetNetCode(nc); v.SetLayerPair(pcbnew.F_Cu,pcbnew.B_Cu); v.SetLocked(True); b.Add(v)   # 0.5/0.2 = 0.15mm annular (>=JLC 0.13); 0.25 drill was 0.125 ring
                placed.append((vx,vy,nc))
                tr=pcbnew.PCB_TRACK(b); tr.SetStart(pcbnew.VECTOR2I(FM(x),FM(y))); tr.SetEnd(pcbnew.VECTOR2I(FM(vx),FM(vy)))
                tr.SetWidth(FM(0.2)); tr.SetLayer(pcbnew.F_Cu if tgt['onF'] else pcbnew.B_Cu); tr.SetNetCode(nc); tr.SetLocked(True); b.Add(tr)
                print(f"  escaped+locked {ref}.{pn} -> via ({vx:.1f},{vy:.1f})"); return
    print(f"  !! could not escape {ref}.{pn}")
# Pre-fan-out the W5500 (U2) LQFP power pins to their planes with clearance-checked escape vias:
# AGND 3,9,14,16,19,48 + GND 29 -> In1;  AVDD 4,8,11,15,17,21 + VDD 28 -> In2. Their 0.5mm pitch
# can't take a via-in-pad, and the autorouter leaves them as stubs, so escape them here instead.
# pins 4 (+3V3) and 16 (GND) are in the tightest corner -- escape them FIRST so they claim the open
# fan-out space before their neighbours fill it (otherwise they're the 2 that fail).
W5500_PWR = [("U2", str(p)) for p in (4, 16, 15, 8, 17, 3, 9, 11, 14, 19, 21, 28, 29, 48)]
for ref,pn in W5500_PWR + [("J2","B5")]:
    escape(ref,pn)
pcbnew.SaveBoard(PCB,b); print("saved with locked escapes")
