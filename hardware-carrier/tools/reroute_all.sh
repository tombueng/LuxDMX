#!/bin/bash
# Alles neu: Kupfer weg, Versorgungsbaum legen, routen, fuellen, pruefen.
# Aufruf: bash tools/reroute_all.sh <Breite> <Tag>
set -u
cd "$(dirname "$0")/.."
W=${1:-5.0}; TAG=${2:-N}
python3 -c "
import pcbnew
b=pcbnew.LoadBoard('luxdmx-carrier.kicad_pcb')
n=0
for t in list(b.GetTracks()): b.Remove(t); n+=1
pcbnew.SaveBoard('luxdmx-carrier.kicad_pcb', b)
print('%d Bahnen und Vias entfernt, blankes Kupfer' % n)
" 2>&1 | grep -v property.h
bash tools/run_route.sh "$W" "$TAG"
