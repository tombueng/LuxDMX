import pcbnew, os, shutil
PCB = r"C:\dev\DMX\hardware\lumigate_carrier.kicad_pcb"
SOCK_LIB = r"C:\dev\DMX\hardware\easyeda\Sock1x10.pretty"
HERE = r"C:\dev\DMX\hardware"
fm = pcbnew.FromMM; mm = pcbnew.ToMM

# copy socket STEP into 3d/
for f in os.listdir(os.path.join(HERE, "easyeda", "Sock1x10.3dshapes")):
    if f.endswith(".step"):
        shutil.copy(os.path.join(HERE, "easyeda", "Sock1x10.3dshapes", f),
                    os.path.join(HERE, "3d", "Sock1x10.step"))

b = pcbnew.LoadBoard(PCB)
codes = {}
for fp in b.GetFootprints():
    for p in fp.Pads():
        if p.GetNetname():
            codes[p.GetNetname()] = p.GetNetCode()

u1 = b.FindFootprintByReference("U1")
u1pos = u1.GetPosition(); u1rot = u1.GetOrientationDegrees()
ROW1_Y = 84.42; ROW2_Y = 109.83; CX = 111.75
b.Remove(u1)


def add_socket(ref, y, netmap):
    fp = pcbnew.FootprintLoad(SOCK_LIB, "HDR-TH_10P-P2.54-V-F")
    fp.SetReference(ref)
    fp.SetValue("1x10 socket 2.54 (C35445)")
    fp.SetPosition(pcbnew.VECTOR2I(fm(CX), fm(y)))
    fp.SetOrientationDegrees(180)
    m = fp.Models()
    while len(m) > 0:
        m.pop()
    md = pcbnew.FP_3DMODEL()
    md.m_Filename = "${KIPRJMOD}/3d/Sock1x10.step"
    md.m_Offset = pcbnew.VECTOR3D(0, 0, 0)
    md.m_Rotation = pcbnew.VECTOR3D(0, 0, 0)
    md.m_Scale = pcbnew.VECTOR3D(1, 1, 1)
    m.push_back(md)
    b.Add(fp)
    fp2 = b.FindFootprintByReference(ref)
    for pad in fp2.Pads():
        nm = netmap.get(pad.GetNumber())
        if nm and nm in codes:
            pad.SetNetCode(codes[nm])
    return fp2


add_socket("J3", ROW1_Y, {"1": "+5V", "2": "+3V3", "3": "GND", "9": "DMX_TX"})
add_socket("J4", ROW2_Y, {"2": "DMX_RX", "5": "RGB_DIN", "6": "DMX_EN"})

# pad-less placeholder carrying the module 3D (so it floats above the sockets)
ph = pcbnew.FOOTPRINT(b)
ph.SetReference("U1")
ph.SetValue("ESP32-POE-ISO module (plug-in)")
ph.SetPosition(u1pos)
ph.SetOrientationDegrees(u1rot)
ph.SetAttributes(pcbnew.FP_EXCLUDE_FROM_POS_FILES | pcbnew.FP_EXCLUDE_FROM_BOM)
md = pcbnew.FP_3DMODEL()
md.m_Filename = "${KIPRJMOD}/3d/ESP32-POE-ISO_full.step"
md.m_Offset = pcbnew.VECTOR3D(0, 0, 10.0)
md.m_Rotation = pcbnew.VECTOR3D(0, 0, 0)
md.m_Scale = pcbnew.VECTOR3D(1, 1, 1)
ph.Models().push_back(md)
b.Add(ph)

for t in list(b.GetTracks()):
    b.Remove(t)
pcbnew.SaveBoard(PCB, b)
print(f"Removed U1 (was {mm(u1pos.x):.1f},{mm(u1pos.y):.1f} rot{u1rot:.0f})")
print("Added J3 (EXT1) + J4 (EXT2) sockets with C35445 3D; U1 = module-3D placeholder")
