#!/usr/bin/env bash
# Reproducible LuxDMX routing pipeline. Run after ANY placement or netlist change:
#   ./route_all.sh
# Net classes (setup_netclasses.py): Default 0.20mm / Power 0.40mm / Fine 0.15mm (W5500-dense only).
# Freerouting routes each net at its class width directly (no post-hoc widening), and is repeated from
# scratch with growing effort until a run lands 0 unrouted. ~2-6 min. Leaves luxdmx.kicad_pcb fab-ready.
KP="/c/Program Files/KiCad/10.0/bin/python.exe"
KC="/c/Program Files/KiCad/10.0/bin/kicad-cli.exe"
HERE="$(cd "$(dirname "$0")" && pwd)"; cd "$HERE"
L=/c/tmp/route_all.log; : > "$L"
run(){ PYTHONUNBUFFERED=1 PYTHONIOENCODING=utf-8 "$KP" "$@" 2>>"$L"; }
unrouted(){ run validate_connectivity.py 2>>"$L" | grep -oE "unrouted nets: [0-9]+" | grep -oE "[0-9]+$"; }

echo "[1] net classes";           run setup_netclasses.py | tail -1
echo "[2] planes + stitch vias";  run rebuild_iso.py >/dev/null; echo "    ok"
echo "[3] connector escapes";     run escape_connectors.py >/dev/null; echo "    ok"

echo "[4] Freerouting -- a few tries for 0 unrouted, else the maze finishes the rest (repeating FR barely"
echo "    helps: it lands the same count each run; the loop is just a cheap safety net, not an optimizer)"
ok=0
for try in 1 2 3; do
  p=$((18 + try * 3))                       # grow effort each retry: 21,24,27 passes
  FR2_PASSES=$p run autoroute_fr2.py >>"$L" 2>&1
  u=$(unrouted)
  echo "    try $try (passes $p): ${u:-?} unrouted"
  if [ "$u" = "0" ]; then ok=1; break; fi
done

echo "[5] finish the rest (partial nets + any straggler) with the maze"
if [ "$ok" = "1" ]; then
  echo "    (Freerouting reached 0 unrouted -- skipped)"
else
  run finish_partial.py | tail -2                   # FR sometimes leaves a net a pad short (a gap); the maze
                                                    # straggler skips those (they have tracks), so delete them first
  MAZE_INFL=0.24 run route_tbu.py | grep -E "routed [0-9]+/8 nets|no path to"
fi

echo "[6] pad cleanup";  run cleanup_pads.py | tail -1
echo "[7] PoE void";     run tighten_poe_void.py | tail -1
echo "[7b] eth impedance"; run widen_eth.py | tail -1     # widen the MDI pairs toward ~50 ohm SE (necks at the QFN)
echo "[8] validate";     run validate_connectivity.py | grep -E "connectivity gate|RESULT"
"$KC" pcb drc --severity-error --format json -o /c/tmp/drc_ra.json luxdmx.kicad_pcb >/dev/null 2>&1
run -c "import json;print('    DRC:',len(json.load(open(r'C:\\tmp\\drc_ra.json'))['violations']),'violations')"
echo "done -- reload in KiCad with File > Revert (do not save over from a stale window). log: $L"
