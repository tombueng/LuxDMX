#!/usr/bin/env bash
# Regenerate everything for the LumiGate enclosure:
#   board params (from the live PCB) -> validation -> printable STLs -> preview PNGs
# Usage:  ./build.sh            (full build)
#         ./build.sh stl        (just the STLs)
set -euo pipefail
cd "$(dirname "$0")"

# locate OpenSCAD (Windows / Linux / mac)
OSCAD="${OPENSCAD:-}"
for c in "/c/Program Files/OpenSCAD/openscad.exe" \
         "/c/Program Files/OpenSCAD (Nightly)/openscad.exe" \
         "$(command -v openscad || true)" \
         "/Applications/OpenSCAD.app/Contents/MacOS/OpenSCAD"; do
    [ -z "$OSCAD" ] && [ -x "$c" ] && OSCAD="$c"
done
[ -z "$OSCAD" ] && { echo "OpenSCAD not found - set \$OPENSCAD"; exit 1; }
echo "OpenSCAD: $OSCAD"

what="${1:-all}"

if [ "$what" = "all" ]; then
    echo ">> extracting board params from ../lumigate.kicad_pcb"
    python extract_case_params.py
    echo ">> validating fit"
    python validate_fit.py
fi

echo ">> exporting STLs"
"$OSCAD" -D 'part="base"'  -o lumigate_case_base.stl  lumigate_case.scad
"$OSCAD" -D 'part="cover"' -o lumigate_case_cover.stl lumigate_case.scad

if [ "$what" = "all" ]; then
    echo ">> rendering preview PNGs"
    mkdir -p prev
    "$OSCAD" -D 'part="assembly"' --viewall --autocenter --imgsize=1200,900 \
             --camera=0,0,0,62,0,28,0  -o prev/assembly.png lumigate_case.scad
    "$OSCAD" -D 'part="exploded"' --viewall --autocenter --imgsize=1200,900 \
             --camera=0,0,0,62,0,28,0  -o prev/exploded.png lumigate_case.scad
    "$OSCAD" -D 'part="base"'     --viewall --autocenter --imgsize=1200,900 \
             --camera=0,0,0,300,0,20,0 -o prev/base.png     lumigate_case.scad
    "$OSCAD" -D 'part="cover"'    --viewall --autocenter --imgsize=1200,900 \
             --camera=0,0,0,250,0,200,0 -o prev/cover.png   lumigate_case.scad
fi

echo ">> done.  STLs:"
ls -la lumigate_case_base.stl lumigate_case_cover.stl
