#!/usr/bin/env bash
# (Re)start the QA browser: asks a running one to quit, then starts a fresh one in the background.
#   tools/qa/start.sh [url]   (default http://127.0.0.1:5195/; log in ~/DMX/sim/qa/browser.log)
cd "$(dirname "$0")/../.." || exit 1
PORT=${QA_PORT:-9333}
curl -s -m 3 -X POST "http://127.0.0.1:$PORT/quit" >/dev/null 2>&1
for _ in $(seq 20); do curl -s -m 1 "http://127.0.0.1:$PORT/pages" >/dev/null 2>&1 || break; sleep 0.5; done
mkdir -p "$HOME/DMX/sim/qa"
nohup nice -n 10 node tools/qa/browser.mjs --port "$PORT" --url "${1:-http://127.0.0.1:5195/}" > "$HOME/DMX/sim/qa/browser.log" 2>&1 &
for _ in $(seq 40); do grep -q "QA browser on" "$HOME/DMX/sim/qa/browser.log" 2>/dev/null && break; sleep 0.5; done
cat "$HOME/DMX/sim/qa/browser.log"
