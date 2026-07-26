#!/usr/bin/env bash
# Fund an address on the local Base fork with WETH and USDC, and approve Aqua.
#
#   scripts/fork-fund.sh maker    # anvil account 0 — ships strategies
#   scripts/fork-fund.sh taker    # anvil account 1 — fills them
#
# WETH comes from wrapping the ETH anvil already granted. USDC has no faucet, so
# its balance slot is written directly: FiatTokenV2_2 keeps balances in
# `balanceAndBlacklistStates` at slot 9, where the top bit is the blacklist flag
# and the rest is the balance — writing a plain amount leaves it un-blacklisted.
set -euo pipefail

RPC="${SLUICE_RPC:-http://127.0.0.1:8545}"
ROLE="${1:-maker}"

# anvil's deterministic accounts 0 and 1.
MAKER_ADDR=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
MAKER_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
TAKER_ADDR=0x70997970C51812dc3A010C7d01b50e0d17dc79C8
TAKER_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d

WETH=0x4200000000000000000000000000000000000006
USDC=0x833589fcd6edb6e08f4c7c32d4f71b54bda02913
AQUA=0x499943e74fb0ce105688beee8ef2abec5d936d31

case "$ROLE" in
  maker) ADDR=$MAKER_ADDR; KEY=$MAKER_KEY; WETH_AMOUNT=5ether; USDC_AMOUNT=25000000000 ;;
  taker) ADDR=$TAKER_ADDR; KEY=$TAKER_KEY; WETH_AMOUNT=2ether; USDC_AMOUNT=5000000000 ;;
  *) echo "usage: $0 [maker|taker]" >&2; exit 2 ;;
esac

cast rpc anvil_nodeInfo --rpc-url "$RPC" > /dev/null 2>&1 || {
  echo "no anvil on $RPC — this script only ever touches a fork, deliberately" >&2
  exit 1
}

cast send "$WETH" "deposit()" --value "$WETH_AMOUNT" --private-key "$KEY" --rpc-url "$RPC" > /dev/null
cast rpc anvil_setStorageAt "$USDC" "$(cast index address "$ADDR" 9)" \
  "$(cast to-uint256 "$USDC_AMOUNT")" --rpc-url "$RPC" > /dev/null

# The maker's allowance to Aqua is what makes a shipped position FILLABLE — Aqua
# pulls the real ERC20 only when a taker fills. The app asks for this itself on a
# first ship; doing it here too keeps the taker step independent of which route
# shipped the strategy.
if [ "$ROLE" = "maker" ]; then
  for T in "$WETH" "$USDC"; do
    cast send "$T" "approve(address,uint256)" "$AQUA" "$(cast max-uint)" \
      --private-key "$KEY" --rpc-url "$RPC" > /dev/null
  done
fi

echo "$ROLE $ADDR"
echo "  WETH $(cast call "$WETH" 'balanceOf(address)(uint256)' "$ADDR" --rpc-url "$RPC" | cut -d' ' -f1)"
echo "  USDC $(cast call "$USDC" 'balanceOf(address)(uint256)' "$ADDR" --rpc-url "$RPC" | cut -d' ' -f1)"
if [ "$ROLE" = "maker" ]; then
  echo "  Aqua allowance set on both tokens"
fi
