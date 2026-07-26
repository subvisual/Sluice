#!/usr/bin/env bash
# The whole demo in one command: a Base fork, an index over it, a funded wallet,
# and the app running with that wallet already connected.
#
#   scripts/demo-up.sh
#
# It is subgraph/local/fork-up.sh + scripts/fork-fund.sh + `npm run dev` in the
# order that makes them work as one thing. The order is the point: the index only
# sees activity after the block it starts at, so it must exist before anything is
# shipped; and the token picker offers what the wallet HOLDS, so the wallet must
# be funded before the app reads it.
#
# Ctrl-C stops the app and leaves the fork and the index up — a restarted UI then
# still finds the positions you shipped. To stop the whole thing:
#
#   scripts/demo-down.sh
#
# The app's pid goes in a file for exactly that reason: like fork-up.sh's
# .anvil.pid, it lets the down script stop what the up script started without
# needing the shell that launched it.
#
# Env: APP_PORT     (default 3000)
#      BASE_RPC_URL upstream chain the fork copies (default https://mainnet.base.org)
#      FORK_BLOCK   block to fork at, or "latest" (default: the pinned block in
#                   config/addresses.8453.json — the venue should not drift
#                   between rehearsals)
set -euo pipefail
cd "$(dirname "$0")/.."

APP_PORT="${APP_PORT:-3000}"
APP_LOG=packages/app/demo.log
APP_PID_FILE=packages/app/.demo-app.pid
RPC=http://127.0.0.1:8545
SUBGRAPH_URL=http://localhost:8000/subgraphs/name/sluice/aqua-local
# anvil account 0 — the address scripts/fork-fund.sh funds under `demo`, and the
# one the app is told to connect. The two MUST agree: the app cannot sign for an
# account anvil does not hold.
DEMO_ACCOUNT=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266

export FOUNDRY_DISABLE_NIGHTLY_WARNING=1

# Asking the socket, not the HTTP response: a next dev whose compile is wedged
# holds the port while answering nothing, and curl alone would call that free.
port_free() {
  if command -v lsof > /dev/null 2>&1; then
    ! lsof -nP -iTCP:"$APP_PORT" -sTCP:LISTEN > /dev/null 2>&1
  else
    ! curl -s --max-time 2 -o /dev/null "http://127.0.0.1:$APP_PORT" 2> /dev/null
  fi
}

# ---------------------------------------------------------------- preflight

for tool in anvil cast node npm npx jq curl docker; do
  command -v "$tool" > /dev/null 2>&1 || { echo "missing: $tool" >&2; exit 1; }
done
# `docker compose` is a plugin and can be absent while `docker` is present.
docker compose version > /dev/null 2>&1 || {
  echo "docker compose (v2) not available — graph-node needs it." >&2
  echo "  brew install docker-compose && ln -sf /opt/homebrew/lib/docker/cli-plugins/docker-compose ~/.docker/cli-plugins/" >&2
  exit 1
}
# Next would silently move to 3001 and every URL printed below would be a lie.
if ! port_free; then
  echo "something is already listening on :$APP_PORT — stop it (scripts/demo-down.sh), or set APP_PORT" >&2
  exit 1
fi
[ -d node_modules ] || npm install

# ------------------------------------------------------- fork + graph stack

FORK_BLOCK="${FORK_BLOCK:-$(jq -r .forkBlock config/addresses.8453.json)}" \
  subgraph/local/fork-up.sh

# ------------------------------------------------------------------- wallet

echo
FUND_OUT=$(scripts/fork-fund.sh demo)
echo "$FUND_OUT"

# ---------------------------------------------------------------------- app

# The app's own env first (0G key, Reown projectId), then the three things this
# script is entitled to decide: which chain to read, which account to connect,
# and which index to join the book against. `set -a` covers the plain assignments
# in a .envrc that direnv would otherwise export for us.
if [ -f packages/app/.envrc ]; then
  set -a
  # shellcheck disable=SC1091
  . ./packages/app/.envrc
  set +a
else
  echo "note: packages/app/.envrc missing — compose will fall back to a template"
fi

export NEXT_PUBLIC_RPC_URL="$RPC"
export NEXT_PUBLIC_DEV_ACCOUNT="$DEMO_ACCOUNT"
export NEXT_PUBLIC_DEV_AUTOCONNECT=1
export SLUICE_SUBGRAPH_URL="$SUBGRAPH_URL"

start_app() {
  # The workspace directly, not the root `dev` script: only this form forwards
  # --port through to `next dev` rather than to the outer npm.
  npm run dev --workspace @sluice/app -- --port "$APP_PORT" > "$APP_LOG" 2>&1 &
  APP_PID=$!
  echo "$APP_PID" > "$APP_PID_FILE"
}

# npm forwards the signal to next, but next's own workers are grandchildren and
# outlive an npm that dies first — so children before parent, or the port stays
# taken and the next run of this script refuses to start.
stop_app() {
  pkill -P "$APP_PID" 2> /dev/null || true
  kill "$APP_PID" 2> /dev/null || true
}
cleanup() {
  stop_app
  rm -f "$APP_PID_FILE"
}

# 0 ready · 1 exited or timed out · 2 turbopack's on-disk cache is corrupt.
# That last one is not hypothetical here: killing `next dev` hard — which is what
# stopping this script does — can leave .next mid-write, and every later compile
# then panics with "Every task must have a task type" while the port still
# listens, so the probe below just times out looking like a slow machine.
wait_for_app() {
  printf "waiting for the first compile"
  for i in $(seq 1 90); do
    # --max-time, because the first request is what triggers the compile and the
    # socket just sits there open while it runs.
    if curl -s --max-time 10 -o /dev/null "http://127.0.0.1:$APP_PORT"; then
      echo " ready"
      return 0
    fi
    if grep -q "Every task must have a task type" "$APP_LOG" 2> /dev/null; then
      echo
      return 2
    fi
    if ! kill -0 "$APP_PID" 2> /dev/null; then
      echo; echo "the app exited — last lines of $APP_LOG:" >&2
      tail -20 "$APP_LOG" >&2
      return 1
    fi
    printf .
    sleep 2
  done
  echo; echo "not ready after 180s — see $APP_LOG" >&2
  return 1
}

echo
echo "starting the app on :$APP_PORT (log: $APP_LOG)"
start_app
trap cleanup EXIT INT TERM

READY=0
wait_for_app || READY=$?
if [ "$READY" = 2 ]; then
  # Safe to delete: .next is a gitignored build cache, and rebuilding it is the
  # cost of one cold compile. Once only — a second corruption is a real bug, not
  # a torn write, and should be seen rather than papered over.
  echo "turbopack's cache is corrupt (a hard kill of a previous run does this)."
  echo "clearing packages/app/.next and starting over — this compile is a cold one"
  stop_app
  # The dying server holds the socket for a moment; start on top of it and next
  # moves to 3001 without saying so, making every URL below wrong.
  for _ in $(seq 1 15); do
    port_free && break
    sleep 1
  done
  rm -rf packages/app/.next
  start_app
  READY=0
  wait_for_app || READY=$?
fi
[ "$READY" = 0 ] || exit 1

# -------------------------------------------------------------------- ready

BLOCK=$(cast block-number --rpc-url "$RPC")
if [ -n "${ZG_PRIVATE_KEY:-}" ]; then
  INFERENCE="ENCLAVE — 0G key present (an unfunded ledger still falls back)"
else
  INFERENCE="TEMPLATE_FALLBACK — no ZG_PRIVATE_KEY, so one strategy, nothing to choose between"
fi

cat <<BANNER

  ───────────────────────────────────────────────────────────────────
   Sluice demo is up

     app        http://localhost:$APP_PORT
     wallet     $DEMO_ACCOUNT — connected on load, no click
$(echo "$FUND_OUT" | tail -n +2 | sed 's/^/      /')
     fork       $RPC · chainId 8453 · block $BLOCK
     index      $SUBGRAPH_URL
     compose    $INFERENCE

   Ctrl-C stops the app; the fork and the index stay up, so what you
   ship survives a restart of the UI. To stop all three:

     scripts/demo-down.sh

   To make a shipped strategy actually fill:

     node scripts/fork-take.mjs --maker $DEMO_ACCOUNT --in USDC --amount 200
  ───────────────────────────────────────────────────────────────────

BANNER

wait "$APP_PID" || true
