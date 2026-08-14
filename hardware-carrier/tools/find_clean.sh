#!/bin/bash
# Baumbreite durchfahren, bis ein Lauf 0 Verstoesse und 0 unverbunden liefert.
# Aufruf: bash tools/find_clean.sh "5.0 4.8 4.6 4.4"
set -u
cd "$(dirname "$0")/.."
LOG=backup/find_clean.log; : > "$LOG"
for W in ${1:-5.0 4.8 4.6 4.4}; do
  python3 -c "
import pcbnew
b=pcbnew.LoadBoard('luxdmx-carrier.kicad_pcb')
for t in list(b.GetTracks()): b.Remove(t)
pcbnew.SaveBoard('luxdmx-carrier.kicad_pcb', b)" >/dev/null 2>&1
  MIN=$(python3 tools/power_tree.py --width "$W" --min 2.0 2>/dev/null | grep -oE 'schmalstes [0-9.]+' | grep -oE '[0-9.]+')
  FR2_GUI=false FR2_TIMEOUT=900 timeout 1000 python3 -u tools/autoroute.py --nozones --passes 20 --tag W$W >/dev/null 2>&1
  for s in finish_stubs build_zones stitch_vias stitch_islands fix_starved_thermals; do
    timeout 540 python3 tools/$s.py >/dev/null 2>&1
  done
  kicad-cli pcb drc --format json --output /tmp/fc-$W.json --severity-error luxdmx-carrier.kicad_pcb >/dev/null 2>&1
  R=$(python3 -c "
import json
d=json.load(open('/tmp/fc-$W.json'))
print('%d %d' % (len(d.get('violations',[])), len(d.get('unconnected_items',[]))))")
  echo "Breite $W (schmalstes ${MIN:-?}): DRC-Verstoesse/unverbunden = $R" >> "$LOG"
  if [ "$R" = "0 0" ]; then
    cp luxdmx-carrier.kicad_pcb backup/luxdmx-carrier-clean-$W.kicad_pcb
    echo "SAUBER bei Breite $W, gesichert" >> "$LOG"; break
  fi
done
echo FERTIG >> "$LOG"
