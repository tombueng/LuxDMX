"""LuxDMX HARDWARE (PCB) version -- the single source of truth for the board revision.

Deliberately SEPARATE from the firmware version (src/generated/version.h, which is
git-tag-derived). The PCB and the firmware are versioned independently: a board respin does
not imply a firmware release and vice-versa. Bump HW_VERSION on any board change that goes
to fab.

Scheme: MAJOR[.MINOR]
  MAJOR -> incompatible board / mechanical / footprint / pinout change (new case, new fab run)
  MINOR -> backward-compatible tweak (value change, silk, reroute) on the same outline

  A fresh MAJOR drops the minor: the board is "v6", not "v6.0".
  The first backward-compatible tweak on top of it becomes v6.1.

Consumed by add_silk_branding.py:
  * silk  "LuxDMX v<HW_VERSION>" on F.Silkscreen
  * board title-block Revision = v<HW_VERSION> (prints on the fab drawing)
"""
HW_VERSION = "6"
