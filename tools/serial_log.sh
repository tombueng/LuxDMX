#!/bin/bash
# Long-running logger for a board that re-enumerates on USB: waits for the port,
# reads until it goes away, waits again. Runs until the PID file is deleted.
PORT="${1:-/dev/ttyACM0}"
LOG="${2:-/home/tomb/dmx-wt/carrier-3out/tools/serial.log}"
echo $$ > "$LOG.pid"
while [ -f "$LOG.pid" ]; do
  if [ -e "$PORT" ]; then
    echo "=== $(date +%H:%M:%S) port up ===" >> "$LOG"
    stty -F "$PORT" 115200 raw -echo 2>/dev/null
    timeout 3600 cat "$PORT" >> "$LOG" 2>/dev/null
    echo "" >> "$LOG"
    echo "=== $(date +%H:%M:%S) port gone ===" >> "$LOG"
  fi
  sleep 0.2
done
