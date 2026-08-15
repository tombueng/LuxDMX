#!/bin/bash
# Sequenz in Dauerschleife, bis die PID-Datei geloescht wird.
D=/home/tomb/dmx-wt/carrier-3out/docs/tests/tools
echo $$ > $D/loop_show.pid
while [ -f "$D/loop_show.pid" ]; do
  node $D/pixel_show.mjs "${1:-dmx-gateway.local}" "${2:-0}" "${3:-60}" "${4:-90}" >/dev/null 2>&1
done
