#!/usr/bin/env bash
# Tear down everything scripts/demo-up.sh started: the app, then the fork and the
# graph stack (subgraph/local/fork-down.sh, which also wipes the index volumes —
# an index that outlives its chain serves plausible wrong data).
#
# Safe to run when parts are already down; each step reports what it found.
set -euo pipefail
cd "$(dirname "$0")/.." # repo root

APP_PORT="${APP_PORT:-3000}"
APP_PID_FILE=packages/app/.demo-app.pid

if [ -f "$APP_PID_FILE" ]; then
  APP_PID=$(cat "$APP_PID_FILE")
  # Children first: next's workers are grandchildren of this pid and outlive an
  # npm that dies before them, keeping the port taken.
  pkill -P "$APP_PID" 2> /dev/null || true
  kill "$APP_PID" 2> /dev/null || true
  rm -f "$APP_PID_FILE"
  echo "app stopped"
elif curl -s --max-time 2 -o /dev/null "http://127.0.0.1:$APP_PORT" 2> /dev/null; then
  # Same courtesy fork-down.sh extends to an anvil it did not start: say what is
  # there, do not kill something this script has no claim on.
  echo "NOTE: something is answering on :$APP_PORT but demo-up.sh did not start it — stop it yourself"
else
  echo "app not running"
fi

subgraph/local/fork-down.sh
