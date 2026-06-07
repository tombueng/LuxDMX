#!/usr/bin/env python
"""Build correct STEP models for XLR NC5FBH and ESP32-POE-ISO using CadQuery.

Olimex ESP32-POE-ISO (real dimensions from Rev.I PCB):
  - PCB: 28.3mm wide (X) × 93.3mm tall (Y) × 1.6mm
  - EXT1/EXT2 header rows at X: -12.7mm and +12.7mm from board centre
  - EXT rows at Y: 39.65mm from top edge (connector/USB side)
  - RJ45 + USB at the bottom (-Y, connector end)
  - WROOM module centred on top of PCB

Model origin = midpoint between EXT1/EXT2 rows (where the carrier U1 anchor is).
  In KiCad 3D coords: X = PCB X, Y = inverted PCB Y, Z = up.
  EXT centre in model coords: (0, 0, 0) at top of PCB.

XLR NC5FBH (horizontal PCB mount, opening faces +X = off board right edge):
  - Round body ø23mm, 35mm from PCB face to back
  - 5 solder pins underneath
"""
import cadquery as cq, os, math

HERE = os.path.dirname(os.path.abspath(__file__))
D3   = os.path.join(HERE, "3d")

# ── ESP32-POE-ISO ─────────────────────────────────────────────────────────────
# Real board: 28.3 W × 93.3 H × 1.6 thick
# EXT centre at (board_centre_X, 39.65mm from top) → model origin = EXT centre
# In model coords (KiCad 3D: Y inverted from PCB):
#   top of board (RJ45/USB side) = model Y + 39.65
#   bottom of board              = model Y - 53.65
BW, BH, BT = 28.3, 93.3, 1.6
EXT_FROM_TOP = 39.65        # EXT centre to top edge
EXT_FROM_BOT = BH - EXT_FROM_TOP  # 53.65

# PCB substrate – origin = EXT centre, top of PCB surface
# In model: Y+ = toward top/RJ45 end, X ±12.7 = EXT rows
pcb = (cq.Workplane("XY")
       .transformed(offset=(0, (EXT_FROM_TOP - EXT_FROM_BOT)/2, -BT/2))
       .box(BW, BH, BT)
       .edges("|Z").fillet(1))

# WROOM-32 module (25.5×18×3.1mm silver) – near top of board (RJ45 end)
wroom = (cq.Workplane("XY")
         .transformed(offset=(0, EXT_FROM_TOP - 20, BT/2 + 3.1/2))
         .box(18, 25.5, 3.1)
         .edges("|Z").fillet(1))

# Antenna (extends 3.5mm beyond WROOM in +Y)
ant = (cq.Workplane("XY")
       .transformed(offset=(0, EXT_FROM_TOP - 7, BT/2 + 3.1/2))
       .box(18, 4, 3.1))

# RJ45 POE (16×16×13.5mm) – at bottom (-Y end)
rj45 = (cq.Workplane("XY")
        .transformed(offset=(0, -(EXT_FROM_BOT - 12), BT/2 + 13.5/2))
        .box(16, 16, 13.5)
        .edges("|Z").fillet(1))

# Micro-USB – next to RJ45
usb = (cq.Workplane("XY")
       .transformed(offset=(8, -(EXT_FROM_BOT - 6), BT/2 + 3.5/2))
       .box(8, 5, 3.5))

# Two 1×10 female-header sockets (2.54mm pitch, 8.5mm tall, ±12.7mm in X)
# Headers span 22.86mm in Y (9 × 2.54mm between pin 1 and pin 10)
hspan = 9 * 2.54  # 22.86mm
hctr_y = 0        # EXT centre in Y = model origin
for hx in (-12.7, 12.7):
    row = (cq.Workplane("XY")
           .transformed(offset=(hx, hctr_y, -(BT/2 + 8.5/2)))
           .box(2.54, hspan, 8.5))
    pcb = pcb.union(row)

esp = pcb.union(wroom).union(ant).union(rj45).union(usb)
cq.exporters.export(esp, os.path.join(D3, "ESP32-POE-ISO_model.step"))
print("ESP32-POE-ISO_model.step written")

# ── XLR NC5FBH (horizontal PCB mount) ────────────────────────────────────────
# Body: cylinder ø23mm, 35mm long (axis along X)
# Opening at +X end (cable plugs in from the right, off the board)
# PCB pins underneath (–Z direction from body centre)
# Footprint anchor ≈ at the PCB-side face of the body

body = (cq.Workplane("YZ")          # circle in YZ plane, extrude along X
        .circle(11.5)
        .extrude(-35))               # extends in –X (into board) from origin

# Entry collar ring at +X face
collar = (cq.Workplane("YZ")
          .circle(11.5).extrude(3))

# 5 pins in pentagonal arrangement (ø1.5mm, 4mm long downward)
pin_r = 6.0
pins_solid = None
for i, a in enumerate([90, 18, -54, -126, 162]):
    py = pin_r * math.cos(math.radians(a))
    pz = pin_r * math.sin(math.radians(a))
    pin = (cq.Workplane("YZ")
           .transformed(offset=(py, pz, 0))
           .circle(0.75).extrude(-4))  # –X = toward PCB
    pins_solid = pin if pins_solid is None else pins_solid.union(pin)

# Mounting tabs (flat ears on either side)
tabs = (cq.Workplane("XZ")
        .transformed(offset=(-17, 0, 0))
        .rect(4, 30).extrude(2))

xlr = body.union(collar).union(tabs)
if pins_solid:
    xlr = xlr.union(pins_solid)

cq.exporters.export(xlr, os.path.join(D3, "NC5FBH.step"))
print("NC5FBH.step written")
