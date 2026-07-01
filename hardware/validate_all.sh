#!/usr/bin/env bash
# Production-readiness gate for luxdmx.kicad_pcb. Runs every validator + DRC and prints a single verdict.
# Run after any routing/placement/netlist change:  ./validate_all.sh
#
# HARD gates (block fab):  connectivity (0 unrouted), DRC (0 violations), geometry/DFM + power current,
#                          DMX isolation (>=4mm creepage), electrical (no FAIL item).
# SOFT gates (quality, surfaced but do not block):  EMC placement (decoupling distances), critical-net SI
#                          (eth/SPI/crystal length, vias, skew, detour, net-class widths).
# Exit code = number of HARD gates failed (0 = production-ready).
KP="/c/Program Files/KiCad/10.0/bin/python.exe"
KC="/c/Program Files/KiCad/10.0/bin/kicad-cli.exe"
HERE="$(cd "$(dirname "$0")" && pwd)"; cd "$HERE"
PCB=luxdmx.kicad_pcb
hard=0; soft=0

gate(){ # $1=label  $2=HARD|SOFT  $3=script
  echo "### $1"
  PYTHONIOENCODING=utf-8 "$KP" "$3" >/c/tmp/_v.txt 2>/dev/null; local rc=$?
  grep -vE "memory leak|destructor" /c/tmp/_v.txt | tail -12
  if [ $rc -ne 0 ]; then
    if [ "$2" = HARD ]; then echo ">>> $1: FAIL  [blocks fab]"; hard=$((hard+1)); else echo ">>> $1: WARN  [quality]"; soft=$((soft+1)); fi
  else
    echo ">>> $1: PASS"
  fi
  echo
}

gate "1  CONNECTIVITY  (0 unrouted)"        HARD validate_connectivity.py

echo "### 2  DRC  (0 violations)"
"$KC" pcb drc --severity-error --schematic-parity --format json -o /c/tmp/_drc.json "$PCB" >/dev/null 2>&1
DN=$(PYTHONIOENCODING=utf-8 "$KP" -c "import json;print(len(json.load(open(r'C:\\tmp\\_drc.json'))['violations']))" 2>/dev/null)
echo "  DRC violations: ${DN:-?}"
if [ "${DN:-1}" != 0 ]; then echo ">>> 2  DRC: FAIL  [blocks fab]"; hard=$((hard+1)); else echo ">>> 2  DRC: PASS"; fi
echo

gate "3  GEOMETRY / DFM + power current"     HARD validate_geometry.py
gate "4  DMX ISOLATION  (>=4mm creepage)"    HARD validate_tbu_iso.py
gate "5  ELECTRICAL  (rails/current/loads)"  HARD validate_electrical.py
gate "6  PLACEMENT / EMC  (decoupling)"      SOFT validate_placement.py
gate "7  CRITICAL NETS  (length/via/skew)"   SOFT validate_critical.py

echo "=================================================================="
if [ $hard -eq 0 ]; then
  echo "PRODUCTION-READY: all hard gates PASS  ($soft soft/quality warning(s))"
else
  echo "NOT PRODUCTION-READY: $hard hard gate(s) FAILED  ($soft soft warning(s))"
fi
exit $hard
