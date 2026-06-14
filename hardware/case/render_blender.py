#!/usr/bin/env python
"""Photoreal documentation renders of the LumiGate board inside its enclosure.

Run head-less:
    blender -b -P render_blender.py -- [diag]

Imports the populated board (lumigate_board.glb, exported by kicad-cli with
--user-origin at the board min corner) + the printed case STLs, aligns the
board into the case frame, assigns a frosted-translucent cover / matte base,
lights a small studio and path-traces several views (Cycles) into ./render/.

'diag' = quick top-ortho + iso alignment check only.
"""
import bpy, bmesh, sys, os, math
from mathutils import Vector, Euler

HERE  = os.path.dirname(os.path.abspath(__file__))
GLB   = os.path.join(HERE, "lumigate_board.glb")
BASE  = os.path.join(HERE, "lumigate_case_base.stl")
COVER = os.path.join(HERE, "lumigate_case_cover.stl")
OUT   = os.path.join(HERE, "render")
os.makedirs(OUT, exist_ok=True)
ARGS  = sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else []
DIAG  = "diag" in ARGS

# --- board placement in the case frame (mm).  board sits on the ledge. ---
STANDOFF = 3.5            # board underside above inner floor (matches the .scad)
FLIP_Y   = False         # board GLB is correct as-is; the .scad now self-corrects via vflip()
ALIGN    = Vector((0, 0, 0))   # fine translation tweak (mm)
RED      = "redglb" in (sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else [])
# board outline (NOT the component bbox) - the board must be aligned to its EDGE so the
# USB-C / connector overhangs don't push everything sideways vs the case openings.
import re as _re
_bp = open(os.path.join(HERE, "board_params.scad")).read()
BOARD_W = float(_re.search(r'board_w\s*=\s*([\d.]+)', _bp).group(1))
BOARD_H = float(_re.search(r'board_h\s*=\s*([\d.]+)', _bp).group(1))
LED_U   = [float(x) for x in _re.search(r'led_u\s*=\s*\[([-\d., ]+)\]', _bp).group(1).split(',') if x.strip()]
LED_V   = float(_re.search(r'led_v\s*=\s*([\d.]+)', _bp).group(1))
LED_COLS = [(1,0.04,0.04),(0.05,1,0.08),(1,0.7,0.03),(0.08,0.2,1),(1,1,1)]  # D2 R, D3 G, D4 Y, D5 B, D6 W

# ============================================================ scene helpers
def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]

def import_stl(path, name):
    before = set(bpy.data.objects)
    try:    bpy.ops.wm.stl_import(filepath=path)
    except Exception:
        try: bpy.ops.import_mesh.stl(filepath=path)
        except Exception: bpy.ops.wm.stl_import(filepath=path)
    objs = [o for o in bpy.data.objects if o not in before]
    for o in objs: o.name = name
    return objs

def world_bbox(objs):
    mn = Vector(( 1e18,)*3); mx = Vector((-1e18,)*3)
    for o in objs:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            for i in range(3):
                mn[i] = min(mn[i], w[i]); mx[i] = max(mx[i], w[i])
    return mn, mx

def set_principled(mat, **vals):
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    aliases = {
        "transmission": ["Transmission Weight", "Transmission"],
        "base_color":   ["Base Color"], "roughness": ["Roughness"],
        "metallic":     ["Metallic"], "ior": ["IOR"], "alpha": ["Alpha"],
        "specular":     ["Specular IOR Level", "Specular"],
        "emission":     ["Emission Color"], "emission_strength": ["Emission Strength"],
    }
    for k, v in vals.items():
        for nm in aliases.get(k, [k]):
            if nm in bsdf.inputs:
                bsdf.inputs[nm].default_value = v; break

def new_mat(name, **vals):
    m = bpy.data.materials.new(name); m.use_nodes = True
    set_principled(m, **vals); return m

# ============================================================ build the scene
clear()

# --- board ---
board = import_glb(GLB)
# single empty parent for the whole board; scale ONCE (no compounding)
root = bpy.data.objects.new("board_root", None)
bpy.context.collection.objects.link(root)
for o in board:
    if o.parent is None or o.parent not in board:
        o.parent = root
bpy.context.view_layer.update()
mn, mx = world_bbox(board)
ext = max(mx.x-mn.x, mx.y-mn.y, mx.z-mn.z)
s = 1000.0 if ext < 5.0 else 1.0           # glTF metres -> mm
print(f"[board] import ext {ext:.4f} -> scale {s}")
root.scale = (s, -s if FLIP_Y else s, s)
bpy.context.view_layer.update()
mn, mx = world_bbox(board)
print(f"[board] scaled  X[{mn.x:.1f},{mx.x:.1f}] Y[{mn.y:.1f},{mx.y:.1f}] Z[{mn.z:.1f},{mx.z:.1f}]")
# find the PCB substrate top = the most common object zmin (SMD parts sit there)
from collections import Counter
zmins = []
objbb = {}
for o in board:
    if o.type != 'MESH': continue
    omn, omx = world_bbox([o]); objbb[o] = (omn, omx)
    zmins.append(round(omn.z, 1))
substrate_top = Counter(zmins).most_common(1)[0][0]
BOARD_TH = 1.6
print(f"[board] substrate_top(raw)={substrate_top:.2f}")
# place against the board EDGE (glTF user-origin = board min corner -> Blender 0):
#   X: min-X board edge already at u=0;  Y: north edge (mx.y) -> v=BOARD_H (not the
#   USB-C overhang -> 0, which shifted every right-wall opening by ~0.8mm).
root.location.x += ALIGN.x
root.location.y += (BOARD_H - mx.y) + ALIGN.y
root.location.z += (STANDOFF - (substrate_top - BOARD_TH)) + ALIGN.z
bpy.context.view_layer.update()
mn, mx = world_bbox(board)
board_top = STANDOFF + BOARD_TH
print(f"[board] placed  X[{mn.x:.1f},{mx.x:.1f}] Y[{mn.y:.1f},{mx.y:.1f}] Z[{mn.z:.1f},{mx.z:.1f}]  board_top={board_top:.2f}")
# per-object heights ABOVE THE BOARD TOP (drives xlr_axis_z / cav_h)
hts = []
for o in board:
    if o.type != 'MESH': continue
    omn, omx = world_bbox([o])
    hts.append((omx.z, omn.z, omn.x, omx.x, omn.y, omx.y, o.name))
hts.sort(reverse=True)
print("[heights] tallest parts (above board_top):")
for z1, z0, x0, x1, y0, y1, nmo in hts[:6]:
    print(f"    z[{z0:6.2f},{z1:6.2f}] top+{z1-board_top:5.2f}  X[{x0:.1f},{x1:.1f}] Y[{y0:.1f},{y1:.1f}]  {nmo}")

# light up the 5 status LEDs (shows the per-LED light caps separating the colours).
# real LED v = BOARD_H - led_v (the .scad design frame is v-mirrored at output)
for i, u in enumerate(LED_U):
    tx, ty = u, BOARD_H - LED_V
    best, bestd = None, 3.0
    for o in board:
        if o.type != 'MESH': continue
        omn, omx = world_bbox([o])
        if omx.z > 7.5 or (omx.x-omn.x) > 3 or (omx.y-omn.y) > 3: continue   # small SMD only
        d = math.hypot((omn.x+omx.x)/2 - tx, (omn.y+omx.y)/2 - ty)
        if d < bestd: bestd, best = d, o
    if best:
        c = LED_COLS[i] if i < len(LED_COLS) else (1,1,1)
        m = new_mat(f"led{i}", base_color=(*c,1), emission=(*c,1), emission_strength=18)
        best.data.materials.clear(); best.data.materials.append(m)
        print(f"[led] {best.name} -> colour {c} (d={bestd:.2f})")

# --- case ---
base  = import_stl(BASE,  "case_base")
cover = import_stl(COVER, "case_cover")
mat_base  = new_mat("base_plastic",  base_color=(0.16,0.17,0.20,1), roughness=0.5, metallic=0.0)
# clear-acrylic cover so the board reads through the walls
mat_cover = new_mat("cover_clear",   base_color=(0.82,0.88,0.97,1), roughness=0.05,
                    transmission=1.0, ior=1.47, metallic=0.0)
set_principled(mat_cover, specular=0.4)
mat_cover.use_screen_refraction = True
for o in base:  o.data.materials.clear(); o.data.materials.append(mat_base)
for o in cover: o.data.materials.clear(); o.data.materials.append(mat_cover)
cover_root = bpy.data.objects.new("cover_root", None); bpy.context.collection.objects.link(cover_root)
for o in cover: o.parent = cover_root
for o in base + cover:
    bpy.context.view_layer.objects.active = o
    try: bpy.ops.object.shade_smooth(use_auto_smooth=True, auto_smooth_angle=math.radians(35))
    except Exception:
        try: bpy.ops.object.shade_auto_smooth(angle=math.radians(35))
        except Exception: pass

# ============================================================ studio + render
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
CHECK = "check" in ARGS
scene.cycles.samples = 48 if (DIAG or CHECK) else 480     # max quality for the final set
try:
    scene.cycles.use_denoising = True
except Exception: pass
try:
    scene.cycles.max_bounces = 32; scene.cycles.transmission_bounces = 24
    scene.cycles.glossy_bounces = 12; scene.cycles.transparent_max_bounces = 32
except Exception: pass
scene.render.resolution_x = 1280 if (DIAG or CHECK) else 2000
scene.render.resolution_y = 960  if (DIAG or CHECK) else 1400
scene.render.film_transparent = False
scene.view_settings.view_transform = 'Filmic' if 'Filmic' in [v.name for v in bpy.types.ColorManagedViewSettings.bl_rna.properties['view_transform'].enum_items] else 'Standard'

# GPU if available
try:
    cp = bpy.context.preferences.addons['cycles'].preferences
    for dt in ('OPTIX', 'CUDA', 'HIP', 'ONEAPI'):
        try:
            cp.compute_device_type = dt; cp.get_devices()
            if any(d.type != 'CPU' for d in cp.devices):
                for d in cp.devices: d.use = True
                scene.cycles.device = 'GPU'; print("GPU:", dt); break
        except Exception: pass
except Exception: pass

# try EEVEE-style refraction in Cycles is automatic; brighter studio world
world = bpy.data.worlds.new("W"); scene.world = world; world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.55,0.58,0.62,1)
world.node_tree.nodes["Background"].inputs[1].default_value = 0.9

# soft floor
bpy.ops.mesh.primitive_plane_add(size=2000, location=(33, 26, -2.2))
floor = bpy.context.active_object
floor.data.materials.append(new_mat("floor", base_color=(0.22,0.23,0.26,1), roughness=0.55))

def area_light(name, loc, energy, size=120, rot=(0,0,0)):
    l = bpy.data.lights.new(name, 'AREA'); l.energy = energy; l.size = size
    ob = bpy.data.objects.new(name, l); ob.location = loc; ob.rotation_euler = Euler(rot)
    bpy.context.collection.objects.link(ob); return ob
area_light("key",  (-30, -70, 150), 7e5, 180, (math.radians(30), math.radians(-12), math.radians(18)))
area_light("fill", (150,  20, 100), 3e5, 200, (math.radians(45), math.radians(28), 0))
area_light("top",  (33,  26, 170), 6e5, 220, (0,0,0))                 # lights the interior through the cover
area_light("rim",  (60,  130, 120), 3.5e5, 150, (math.radians(52), 0, math.radians(180)))

TARGET = Vector((33, 26, 12))
def add_cam(name, loc, ortho=False, scale=120, lens=55, aim=None):
    cam = bpy.data.cameras.new(name); cam.lens = lens
    if ortho: cam.type = 'ORTHO'; cam.ortho_scale = scale
    ob = bpy.data.objects.new(name, cam); ob.location = loc
    bpy.context.collection.objects.link(ob)
    d = ((aim if aim is not None else TARGET) - Vector(loc))
    ob.rotation_euler = d.to_track_quat('-Z','Y').to_euler()
    return ob
# LED wall close-up: the windows are on the +Y wall (real LEDs at v = BOARD_H - LED_V)
LED_AIM = Vector((sum(LED_U)/len(LED_U), BOARD_H - LED_V, STANDOFF + BOARD_TH + 1.5))
LED_CAM = (sum(LED_U)/len(LED_U), BOARD_H - LED_V + 95, STANDOFF + BOARD_TH + 22)

def show(objs, vis):
    for o in objs:
        o.hide_render = not vis

def render(cam, fn):
    scene.camera = cam
    scene.render.filepath = os.path.join(OUT, fn)
    bpy.ops.render.render(write_still=True)
    print("wrote", fn)

def export_assembly_glb():
    # translucent cover so the board reads through it in any glTF viewer
    set_principled(mat_cover, alpha=0.4, transmission=0.0)
    mat_cover.blend_method = 'BLEND'
    for o in (base + cover + board): o.hide_render = False
    for o in bpy.data.objects: o.select_set(False)
    for o in (base + cover + board): o.select_set(True)
    out = os.path.join(HERE, "lumigate_case_assembly.glb")
    bpy.ops.export_scene.gltf(filepath=out, use_selection=True, export_format='GLB')
    print("wrote", out)

def export_red_glb():
    # housing RED + only slightly translucent, to judge the cut-outs vs the connectors
    for m in (mat_base, mat_cover):
        set_principled(m, base_color=(0.78,0.06,0.06,1), alpha=0.6, transmission=0.0, roughness=0.4)
        m.blend_method = 'BLEND'
    for o in (base + cover + board): o.hide_render = False
    for o in bpy.data.objects: o.select_set(False)
    for o in (base + cover + board): o.select_set(True)
    out = os.path.join(HERE, "lumigate_case_assembly_red.glb")
    bpy.ops.export_scene.gltf(filepath=out, use_selection=True, export_format='GLB')
    print("wrote", out)

if RED:
    # quick: red inspection GLB + a connector close-up to check the cut-out fit
    show(cover, True); cover_root.location = (0,0,0)
    for m in (mat_base, mat_cover):
        set_principled(m, base_color=(0.78,0.06,0.06,1), alpha=0.6, transmission=0.0, roughness=0.4)
        m.blend_method = 'BLEND'
    scene.cycles.samples = 96
    render(add_cam("rcheck", (215, 22, 48), lens=80), "red_connectors.png")
    render(add_cam("rusbc", (37, -130, 30), lens=95), "red_usbc.png")     # USB-C front close-up (lip fix)
    render(add_cam("rleds", LED_CAM, lens=110, aim=LED_AIM), "red_leds.png")  # LED caps
    for o in (base + cover + board): o.hide_render = False
    for o in bpy.data.objects: o.select_set(False)
    for o in (base + cover + board): o.select_set(True)
    out = os.path.join(HERE, "lumigate_case_assembly_red.glb")
    bpy.ops.export_scene.gltf(filepath=out, use_selection=True, export_format='GLB')
    print("wrote", out)
elif "glbonly" in ARGS:
    export_assembly_glb()                 # skip the slow Cycles renders, just re-export the GLB
elif DIAG:
    render(add_cam("top", (33, 26, 240), ortho=True, scale=110), "diag_top.png")
    render(add_cam("iso", (-90, -95, 120)), "diag_iso.png")
elif "xlr" in ARGS:
    # straight-on close-up of the XLR mating face (cover hidden) to see screws + PUSH
    show(cover, False)
    bt = STANDOFF + BOARD_TH            # board top z = 5.1
    aim = Vector((74.6, 14.6, bt + 13.0))
    cam = bpy.data.cameras.new("xlr"); cam.lens = 110
    ob = bpy.data.objects.new("xlr", cam); ob.location = (130, 14.6, bt + 13.0)
    bpy.context.collection.objects.link(ob)
    ob.rotation_euler = (aim - Vector(ob.location)).to_track_quat('-Z','Y').to_euler()
    render(ob, "xlr_face.png")
elif CHECK:
    cover_root.location = (0,0,0); show(cover, True)
    render(add_cam("hero",  (150, -108, 96), lens=50), "01_hero_assembled.png")
    render(add_cam("right", (220, 24, 52), lens=78), "02_connectors_right.png")
    render(add_cam("topdown", (44, 6, 245), lens=90), "05_topdown.png")
    export_assembly_glb()
else:
    cover_root.location = (0,0,0); show(cover, True)
    # 1. HERO - from the connector corner: USB-C (front) + DMX/Ethernet (right), looking back
    render(add_cam("hero",  (150, -108, 96), lens=50), "01_hero_assembled.png")
    # 2. right wall straight-on (XLR + RJ45)
    render(add_cam("right", (220, 24, 52), lens=78), "02_connectors_right.png")
    # 3. front wall straight-on (USB-C)
    render(add_cam("front", (37, -150, 44), lens=78), "06_front_usbc.png")
    # 4. cover off - board seated in the base tray (connector-corner angle)
    show(cover, False)
    render(add_cam("open", (150, -108, 116)), "03_board_in_base.png")
    # 5. exploded - cover lifted off
    show(cover, True); cover_root.location = (0,0,52)
    render(add_cam("expl", (150, -115, 130)), "04_exploded.png")
    # 6. top, but slightly from the side (not dead-on top-down)
    cover_root.location = (0,0,0)
    render(add_cam("topdown", (44, 6, 245), lens=90), "05_topdown.png")
    render(add_cam("leds", LED_CAM, lens=110, aim=LED_AIM), "07_leds.png")   # LED light-guide caps
    export_assembly_glb()
print("DONE")
