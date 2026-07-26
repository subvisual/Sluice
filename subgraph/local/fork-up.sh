#!/usr/bin/env bash
# Stand up the local indexing stack: anvil fork of Base + graph-node + the Aqua
# subgraph, indexing from the fork block onward (never the real deploy blocks —
# see README §6: historical indexing through anvil never catches up).
#
# Run this BEFORE sending local transactions: activity from before the deployed
# startBlock is invisible to the index.
#
# Env: BASE_RPC_URL — upstream RPC for the fork (default: https://mainnet.base.org)
set -euo pipefail
cd "$(dirname "$0")/.." # subgraph/

RPC=http://127.0.0.1:8545
BASE_RPC_URL="${BASE_RPC_URL:-https://mainnet.base.org}"
NODE=http://localhost:8020
IPFS=http://localhost:5001
STATUS=http://localhost:8030/graphql
QUERY=http://localhost:8000/subgraphs/name/sluice/aqua-local

rpc() { curl -s "$RPC" -H 'content-type: application/json' -d "$1"; }
have_anvil() { rpc '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' | grep -q '"result"'; }

# 1. anvil fork
if have_anvil; then
  echo "anvil already running on :8545 (note: local txs sent before now won't be indexed)"
  # An anvil started without --host 0.0.0.0 is invisible to graph-node — see the
  # comment on the anvil launch below. Worth saying now rather than letting the
  # index sit at the start block looking merely slow.
  if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:8545 -sTCP:LISTEN 2>/dev/null | grep -q '127.0.0.1:8545'; then
    echo "  WARNING: it is bound to 127.0.0.1 only, so the graph-node container cannot reach it."
    echo "           Restart it with --host 0.0.0.0 or the index will never advance."
  fi
else
  echo "starting anvil (fork: $BASE_RPC_URL)"
  # --host 0.0.0.0 is REQUIRED, not a preference: graph-node runs in a container
  # and reaches the chain over host.docker.internal, which arrives on a non-loopback
  # interface. anvil's default 127.0.0.1 bind refuses it, and the only symptom is
  # "unable to fetch genesis" in the graph-node log followed by an index that never
  # advances. It does mean the fork is reachable from your LAN — it holds nothing
  # but well-known test keys, but do not run it on an untrusted network.
  nohup anvil --fork-url "$BASE_RPC_URL" --block-time 2 --host 0.0.0.0 >local/anvil.log 2>&1 &
  echo $! >local/.anvil.pid
  for i in $(seq 1 30); do
    sleep 1
    have_anvil && break
    [ "$i" = 30 ] && { echo "ERROR: anvil failed to start — see local/anvil.log"; exit 1; }
  done
fi

# 2. fork block = subgraph startBlock
FORK_BLOCK=$(rpc '{"jsonrpc":"2.0","id":1,"method":"anvil_metadata","params":[]}' | jq -r '.result.forkedNetwork.forkBlockNumber // empty')
if [ -z "$FORK_BLOCK" ]; then
  FORK_BLOCK=$(($(rpc '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' | jq -r '.result')))
fi
echo "fork block (startBlock): $FORK_BLOCK"

# 3. graph-node stack
docker compose -f local/docker-compose.yml up -d
printf "waiting for graph-node"
for i in $(seq 1 60); do
  if curl -s "$STATUS" -H 'content-type: application/json' -d '{"query":"{ indexingStatuses { subgraph } }"}' | grep -q '"data"'; then
    echo " ready"
    break
  fi
  printf .
  sleep 2
  [ "$i" = 60 ] && { echo; echo "ERROR: graph-node not ready after 120s — check: docker compose -f local/docker-compose.yml logs graph-node"; exit 1; }
done

# 4. build a local manifest (leaves the tracked subgraph.yaml untouched)
cat >local/networks-local.json <<EOF
{
  "base": {
    "AquaRouter": { "address": "0x499943e74fb0ce105688beee8ef2abec5d936d31", "startBlock": $FORK_BLOCK },
    "AquaSwapVMRouter": { "address": "0x8fdd04dbf6111437b44bbca99c28882434e0958f", "startBlock": $FORK_BLOCK }
  }
}
EOF
cp subgraph.yaml subgraph.local.yaml
# generated/ is gitignored, so a fresh clone has no types and `graph build` dies
# with "The AssemblyScript compiler crashed" — which reads like a compiler bug and
# is really just a missing codegen. Both steps are idempotent.
[ -d node_modules ] || npm install
npx graph codegen subgraph.local.yaml
npx graph build subgraph.local.yaml --network base --network-file local/networks-local.json

# 5. deploy to the local node. The first deploy after a cold start can drop the
# connection (ECONNRESET) while graph-node is still warming up — the node has
# usually accepted it anyway, but retrying once is cheaper than reasoning about
# which half happened.
npx graph create sluice/aqua-local --node "$NODE" 2>/dev/null || true
deploy() {
  npx graph deploy sluice/aqua-local subgraph.local.yaml --node "$NODE" --ipfs "$IPFS" --version-label v0.1.0-local
}
deploy || { echo "deploy failed once (graph-node still warming up?) — retrying"; sleep 5; deploy; }

# 6. smoke check
sleep 5
echo
echo "smoke check:"
curl -s "$QUERY" -H 'content-type: application/json' \
  -d '{"query":"{ _meta { block { number } hasIndexingErrors } }"}' | jq .
echo
echo "query endpoint: $QUERY"
echo "after an anvil restart the index is stale — run: make fork-reset"
