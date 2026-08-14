#!/bin/bash
# Eine Routing-Runde: Versorgungsbaum legen, routen, Flaechen fuellen, pruefen.
# Aufruf: bash tools/run_route.sh <Breite> <Tag>
set -u
cd "$(dirname "$0")/.."
W=${1:-5.0}; TAG=${2:-R}
timeout 900 python3 tools/power_tree.py --width "$W" --min 2.0 2>&1 | grep -vE "property.h" | tail -3
FR2_GUI=false FR2_TIMEOUT=900 timeout 1000 python3 -u tools/autoroute.py --nozones --passes 20 --tag "$TAG" 2>&1 | grep -E "bestes|verbunden" | tail -2
for s in finish_stubs build_zones stitch_vias stitch_islands fix_starved_thermals; do
  timeout 2000 python3 tools/$s.py >/dev/null 2>&1
done
timeout 900 kicad-cli pcb drc --format json --output /tmp/drc-$TAG.json --severity-error luxdmx-carrier.kicad_pcb >/dev/null 2>&1
python3 -c "
import json,collections
d=json.load(open('/tmp/drc-$TAG.json'))
v=d.get('violations',[]); u=d.get('unconnected_items',[])
print('Verstoesse %d %s | unverbunden %d' % (len(v), dict(collections.Counter(x.get('type') for x in v)), len(u)))
for x in u:
    print('   ' + ' <-> '.join(i.get('description','')[:38] for i in x.get('items',[])))
"
