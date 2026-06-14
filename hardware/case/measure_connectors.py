#!/usr/bin/env python
"""Measure the REAL through-wall geometry of the connectors from the populated GLB.

    blender -b -P measure_connectors.py

For the XLR (J1) and RJ45 (J3) it reports the geometry of the part that pokes past
the board right edge (u >= board_w) - i.e. exactly what the wall opening must match:
the barrel/face centre (v, z above board top) and its size.  USB-C likewise on the
bottom edge.  These numbers feed lumigate_case.scad's opening parameters.
"""
import bpy, os, math
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
GLB  = os.path.join(HERE, "lumigate_board.glb")
STANDOFF, BOARD_TH = 3.5, 1.6
BOARD_W = 74.644
BOARD_TOP = STANDOFF + BOARD_TH

bpy.ops.wm.read_factory_settings(use_empty=True)
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=GLB)
board = [o for o in bpy.data.objects if o not in before]
root = bpy.data.objects.new("root", None); bpy.context.collection.objects.link(root)
for o in board:
    if o.parent is None or o.parent not in board: o.parent = root
bpy.context.view_layer.update()

def wbb(objs):
    mn = Vector((1e18,)*3); mx = Vector((-1e18,)*3)
    for o in objs:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            for i in range(3): mn[i]=min(mn[i],w[i]); mx[i]=max(mx[i],w[i])
    return mn, mx

mn, mx = wbb(board)
ext = max(mx.x-mn.x, mx.y-mn.y, mx.z-mn.z)
root.scale = (1000, -1000, 1000) if ext < 5 else (1, -1, 1)
bpy.context.view_layer.update()
# substrate top = modal object zmin
from collections import Counter
zmins = []
for o in board:
    if o.type=='MESH':
        omn,_ = wbb([o]); zmins.append(round(omn.z,1))
substrate_top = Counter(zmins).most_common(1)[0][0]
mn, mx = wbb(board)
root.location.y += (0 - mn.y)
root.location.z += (STANDOFF - (substrate_top - BOARD_TH))
bpy.context.view_layer.update()

def world_verts(o):
    m = o.matrix_world
    return [m @ v.co for v in o.data.vertices]

# find connectors by their through-wall vertices
print(f"\nboard_top = {BOARD_TOP:.2f} mm   board right edge u = {BOARD_W:.2f}\n")
results = {}
for o in board:
    if o.type != 'MESH': continue
    vs = [w for w in world_verts(o) if w.x >= BOARD_W - 0.2]   # poking past right edge
    if len(vs) < 8: continue
    ys = [w.y for w in vs]; zs = [w.z for w in vs]
    vc = (min(ys)+max(ys))/2
    results[o.name] = (vc, min(ys), max(ys), min(zs), max(zs), len(vs))

WALL = 2.4
for nm,(vc,y0,y1,z0,z1,n) in sorted(results.items(), key=lambda kv: kv[1][0]):
    label = "XLR" if abs(vc-14.6)<6 else ("RJ45" if abs(vc-39.7)<6 else "?")
    print(f"[{label:4s}] full through-wall: v[{y0:.2f},{y1:.2f}] c{vc:.2f} w{y1-y0:.2f}  "
          f"z above top[{z0-BOARD_TOP:.2f},{z1-BOARD_TOP:.2f}] h={z1-z0:.2f}")
    # cross-section AT the wall plane = exactly what the opening must match
    obj = bpy.data.objects[nm]
    sl = [w for w in world_verts(obj) if BOARD_W+0.2 <= w.x <= BOARD_W+WALL]
    if len(sl) >= 8:
        ys=[w.y for w in sl]; zs=[w.z for w in sl]
        print(f"        @wall slice: v[{min(ys):.2f},{max(ys):.2f}] c{(min(ys)+max(ys))/2:.2f} "
              f"w{max(ys)-min(ys):.2f}  z above top[{min(zs)-BOARD_TOP:.2f},{max(zs)-BOARD_TOP:.2f}] "
              f"cz={(min(zs)+max(zs))/2-BOARD_TOP:.2f} h={max(zs)-min(zs):.2f}")

# XLR detail: flange circle, PUSH latch (topmost front feature), screw-hole ring
xlr = None
for o in board:
    if o.type=='MESH':
        vs=[w for w in world_verts(o) if w.x>=BOARD_W-0.2]
        if len(vs)>=8 and abs((min(v.y for v in vs)+max(v.y for v in vs))/2 - 14.6) < 6:
            xlr=o; break
if xlr:
    vw=[w for w in world_verts(xlr)]
    front=[w for w in vw if w.x >= max(v.x for v in vw)-0.6]   # mating-face plane
    fy=[w.y for w in front]; fz=[w.z for w in front]
    cy=(min(fy)+max(fy))/2; cz=(min(fz)+max(fz))/2
    print(f"\n[XLR face] centre v={cy:.2f} z(abs)={cz:.2f} z+top={cz-BOARD_TOP:.2f}  "
          f"flange v[{min(fy):.2f},{max(fy):.2f}] z[{min(fz):.2f},{max(fz):.2f}] "
          f"dia~{max(max(fy)-min(fy),max(fz)-min(fz)):.1f}")
    # PUSH latch: highest-z cluster at the front
    top=max(vw,key=lambda w:w.z)
    print(f"[XLR PUSH?] topmost vert v={top.y:.2f} z+top={top.z-BOARD_TOP:.2f} x={top.x:.2f}")
    # vertices that sit OUTSIDE the barrel (radius>9.5 from centre) on the face = flange/screws
    import math as _m
    ring=[w for w in front if _m.hypot(w.y-cy, w.z-cz) > 9.0]
    if ring:
        rys=[w.y for w in ring]; rzs=[w.z for w in ring]
        print(f"[XLR flange ring] v[{min(rys):.2f},{max(rys):.2f}] z+top[{min(rzs)-BOARD_TOP:.2f},{max(rzs)-BOARD_TOP:.2f}]")

# USB-C: poking past the bottom edge (v >= board_h)
BOARD_H = 51.434
print()
for o in board:
    if o.type != 'MESH': continue
    vs = [w for w in world_verts(o) if w.y >= BOARD_H - 0.2]
    if len(vs) < 8: continue
    xs=[w.x for w in vs]; zs=[w.z for w in vs]
    print(f"[USB-C?] through bottom: u[{min(xs):.2f},{max(xs):.2f}] c{(min(xs)+max(xs))/2:.2f} "
          f"w{max(xs)-min(xs):.2f}  z above top[{min(zs)-BOARD_TOP:.2f},{max(zs)-BOARD_TOP:.2f}]")
print("\nDONE")
