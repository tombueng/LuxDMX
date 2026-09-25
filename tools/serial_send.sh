#!/bin/bash
# Zeilen an die Konsole eines Boards schicken, dessen Port schon ein Logger liest.
# Schreiben und Lesen auf demselben tty stoeren sich nicht; die Antworten landen im Log.
#   tools/serial_send.sh /dev/ttyACM0 datei.txt [pause]
#   echo dump | tools/serial_send.sh /dev/ttyACM0 -
PORT="${1:-/dev/ttyACM0}"
SRC="${2:--}"
PAUSE="${3:-0.12}"
stty -F "$PORT" 115200 raw -echo 2>/dev/null
n=0
while IFS= read -r line; do
  [ -z "$line" ] && continue
  printf '%s\r\n' "$line" > "$PORT"
  n=$((n+1))
  sleep "$PAUSE"
done < <(cat "$SRC")
echo "sent $n lines to $PORT"
