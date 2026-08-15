#!/bin/bash
D=/home/tomb/dmx-wt/carrier-3out/docs/tests/tools
echo $$ > $D/loop_fx.pid
while [ -f "$D/loop_fx.pid" ]; do
  node $D/pixel_fx.mjs "${1:-dmx-gateway.local}" "${2:-0}" "${3:-24,16,6,1}" "${4:-12}" >/dev/null 2>&1
done
