#!/usr/bin/env bash
# Tear down the local stack. Wipes graph-node's volumes (-v): after any anvil
# restart the stored index is silently inconsistent, so state is never kept.
set -euo pipefail
cd "$(dirname "$0")/.." # subgraph/

docker compose -f local/docker-compose.yml down -v

if [ -f local/.anvil.pid ]; then
  kill "$(cat local/.anvil.pid)" 2>/dev/null || true
  rm -f local/.anvil.pid
  echo "anvil stopped"
elif curl -s http://127.0.0.1:8545 -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' | grep -q '"result"'; then
  echo "NOTE: an anvil not started by fork-up is still running on :8545 — stop it yourself if you want a clean fork"
fi
