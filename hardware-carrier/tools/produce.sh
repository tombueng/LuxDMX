#!/bin/bash
# Vollstaendiger Fertigungslauf: Kupfer weg, Versorgungsbaum, Autorouter, Handrouter fuer den
# Rest, Flaechen, Vias, Waermefallen, DRC. Aufruf: bash tools/produce.sh [Breite]
set -u
cd "$(dirname "$0")/.."
W=${1:-4.8}
say(){ printf '\n=== %s\n' "$1"; }

say "blankes Kupfer"
python3 -c "
import pcbnew
b=pcbnew.LoadBoard('luxdmx-carrier.kicad_pcb')
n=0
for t in list(b.GetTracks()): b.Remove(t); n+=1
pcbnew.SaveBoard('luxdmx-carrier.kicad_pcb', b); print('%d Bahnen und Vias entfernt' % n)" 2>&1 | grep -vE "property.h|memory leak"

say "Versorgungsbaum $W mm"
python3 tools/power_tree.py --width "$W" --min 2.0 2>&1 | grep -vE "property.h|memory leak"

# Nets that have to go down BEFORE the autorouter, because afterwards there is no way in.
# PIX2_5V leaves the buffer between two SOIC pads 1.27 mm apart: a 0.35 mm track with 0.20 mm
# clearance needs 0.75 mm of the 0.67 mm gap, so its only way out is off the end of the pad,
# and once the autorouter has run something across that end the net is walled in. The maze
# router then finds nothing at 0.2 mm and nothing at 0.1 mm either, because there is genuinely
# nothing to find. Laid first and locked, it takes the corridor it needs and the autorouter
# goes round.
for n in ${PRELAY:-}; do
  say "Handrouter (vorab) $n"
  timeout 900 python3 tools/hand_route.py --net "$n" 2>&1 | grep -vE "property.h|memory leak"
done

say "Autorouter"
FR2_GUI=false FR2_TIMEOUT=900 timeout 1000 python3 -u tools/autoroute.py --nozones --passes 20 --tag PROD 2>&1 | grep -E "verbunden|geschrieben"

say "was noch offen ist"
kicad-cli pcb drc --format json --output /tmp/prod-a.json --severity-error luxdmx-carrier.kicad_pcb >/dev/null 2>&1
NETS=$(python3 -c "
import json
d=json.load(open('/tmp/prod-a.json'))
out=[]
for u in d.get('unconnected_items',[]):
    for it in u.get('items',[]):
        s=it.get('description','')
        if '[' in s:
            n=s.split('[',1)[1].split(']',1)[0]
            if n not in out: out.append(n)
print(' '.join(out))")
echo "offene Netze: ${NETS:-keine}"

# GND is poured by build_zones and sewn together by stitch_islands. It shows up in this list
# only because stripping the tracks leaves the old fill stale, and a maze router with tens of
# thousands of its own cells grinds on it for ever instead of fixing anything.
for n in $NETS; do
  case "$n" in GND) echo "  GND uebersprungen, das erledigen Flaechen und Naehvias"; continue;; esac
  say "Handrouter $n"
  timeout 900 python3 tools/hand_route.py --net "$n" 2>&1 | grep -vE "property.h|memory leak"
  # Auf 0.2 mm rundet ein Korridor von 0.8 mm gern auf 0.6 ab und gilt als dicht. Wer dort
  # nichts findet, darf es feiner versuchen, bevor wir aufgeben.
  if [ "${PIPESTATUS[0]}" = "2" ]; then
    echo "  -> zweiter Versuch auf 0.1 mm Raster"
    timeout 900 python3 tools/hand_route.py --net "$n" --grid 0.1 2>&1 | grep -vE "property.h|memory leak"
  fi
done

say "Flaechen, Vias, Waermefallen"
for s in finish_stubs build_zones stitch_vias stitch_islands fix_starved_thermals; do
  printf '  %-22s ' "$s"
  timeout 540 python3 tools/$s.py > backup/step-$s.log 2>&1 && echo ok || echo FEHLER
done

say "DRC"
kicad-cli pcb drc --format json --output /tmp/prod-b.json --severity-error luxdmx-carrier.kicad_pcb >/dev/null 2>&1
python3 -c "
import json,collections
d=json.load(open('/tmp/prod-b.json'))
v=d.get('violations',[]); u=d.get('unconnected_items',[])
print('%d Verstoesse %s | %d unverbunden' % (len(v),dict(collections.Counter(x.get('type') for x in v)),len(u)))
for x in v[:8]: print('   %-22s %s' % (x.get('type'),x.get('description','')[:64]))
for x in u[:8]: print('   offen: ' + ' <-> '.join(i.get('description','')[:34] for i in x.get('items',[])))"
