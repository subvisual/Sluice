#!/usr/bin/env bash
# Fund an address on the local Base fork with tokens, and approve Aqua.
#
#   scripts/fork-fund.sh maker    # anvil account 0 — ships strategies
#   scripts/fork-fund.sh taker    # anvil account 1 — fills them
#   scripts/fork-fund.sh demo     # anvil account 0 again, demo balance sheet:
#                                 # 100 ETH, 10 WETH, 1000 USDC, 1 cbBTC
#
# `demo` is the same ADDRESS as `maker` — a role here names a balance sheet, not
# a wallet. scripts/demo-up.sh uses it; maker/taker belong to the ship-then-fill
# rehearsal, where the two sides must be different addresses to prove anything.
#
# No token here has a faucet on a fork, so balances are written straight into the
# balance slot — see set_erc20_balance, which finds that slot rather than trusting
# a table. Every amount below is a target, not a top-up: run it twice and the
# account holds what the role says, not double.
#
# WETH used to come from wrapping the ETH anvil granted. It no longer does, and
# the reason is worth keeping: **anvil's accounts 0 and 1 carry an EIP-7702
# delegation on real Base** (their private keys are public, so someone set one),
# and a fork inherits it. They therefore have CODE. `WETH.withdraw()` pays out
# with a 2300-gas `transfer`, that stipend runs the delegate, and it reverts with
# a bare `0x` — so these accounts can wrap but never unwrap. Nothing in the demo
# unwraps, but a `withdraw` that "should obviously work" failing is a long
# afternoon if you meet it without this note.
set -euo pipefail

# A nightly-build advisory printed by every cast call buries the balances below.
export FOUNDRY_DISABLE_NIGHTLY_WARNING=1

RPC="${SLUICE_RPC:-http://127.0.0.1:8545}"
ROLE="${1:-maker}"

# anvil's deterministic accounts 0 and 1.
MAKER_ADDR=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
MAKER_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
TAKER_ADDR=0x70997970C51812dc3A010C7d01b50e0d17dc79C8
TAKER_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d

WETH=0x4200000000000000000000000000000000000006
USDC=0x833589fcd6edb6e08f4c7c32d4f71b54bda02913
CBBTC=0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf
AQUA=0x499943e74fb0ce105688beee8ef2abec5d936d31

# Token amounts are base units: WETH 18dp, USDC 6dp, cbBTC 8dp. ETH_TARGET is a
# whole-ether count, empty meaning "leave anvil's grant alone"; it is applied
# LAST, after the gas this script spends, so it is the balance the account ends
# with rather than one it briefly had.
case "$ROLE" in
  maker) ADDR=$MAKER_ADDR; KEY=$MAKER_KEY
         WETH_UNITS=5000000000000000000;  USDC_UNITS=25000000000; CBBTC_UNITS=0;         ETH_TARGET=;    APPROVE=yes ;;
  taker) ADDR=$TAKER_ADDR; KEY=$TAKER_KEY
         WETH_UNITS=2000000000000000000;  USDC_UNITS=5000000000;  CBBTC_UNITS=0;         ETH_TARGET=;    APPROVE=no  ;;
  demo)  ADDR=$MAKER_ADDR; KEY=$MAKER_KEY
         WETH_UNITS=10000000000000000000; USDC_UNITS=1000000000;  CBBTC_UNITS=100000000; ETH_TARGET=100; APPROVE=yes ;;
  *) echo "usage: $0 [maker|taker|demo]" >&2; exit 2 ;;
esac

cast rpc anvil_nodeInfo --rpc-url "$RPC" > /dev/null 2>&1 || {
  echo "no anvil on $RPC — this script only ever touches a fork, deliberately" >&2
  exit 1
}

# Write an ERC20 balance by FINDING the mapping slot rather than asserting one:
# probe each candidate with a sentinel and keep whichever slot balanceOf reads
# back. Slot 9 is tried first because both USDC (FiatTokenV2_2) and cbBTC keep
# balances there today, so the loop normally ends on its first attempt — but a
# token that lays its storage out differently gets funded instead of silently
# staying at zero. Every slot the probe rejects is restored to what it held.
#
# USDC packs a blacklist flag into the top bit of that word
# (`balanceAndBlacklistStates`) — writing a plain amount leaves the flag clear,
# which is what we want, since a blacklisted holder cannot transfer at all.
set_erc20_balance() {
  token=$1; holder=$2; amount=$3
  [ "$amount" = "0" ] && return 0
  for slot in 9 0 1 2 3 4 5 6 7 8 10 11 12 13 14 15; do
    key=$(cast index address "$holder" "$slot")
    prev=$(cast storage "$token" "$key" --rpc-url "$RPC")
    cast rpc anvil_setStorageAt "$token" "$key" "$(cast to-uint256 "$amount")" --rpc-url "$RPC" > /dev/null
    got=$(cast call "$token" 'balanceOf(address)(uint256)' "$holder" --rpc-url "$RPC" | cut -d' ' -f1)
    [ "$got" = "$amount" ] && return 0
    cast rpc anvil_setStorageAt "$token" "$key" "$prev" --rpc-url "$RPC" > /dev/null
  done
  echo "no balance slot found for $token — its storage is not a plain mapping" >&2
  return 1
}

set_erc20_balance "$WETH" "$ADDR" "$WETH_UNITS"
set_erc20_balance "$USDC" "$ADDR" "$USDC_UNITS"
set_erc20_balance "$CBBTC" "$ADDR" "$CBBTC_UNITS"

# The maker's allowance to Aqua is what makes a shipped position FILLABLE — Aqua
# pulls the real ERC20 only when a taker fills. The app asks for this itself on a
# first ship; doing it here too keeps the taker step independent of which route
# shipped the strategy, and keeps a demo down to the one signature it promises.
APPROVED=""
if [ "$APPROVE" = "yes" ]; then
  APPROVE_TOKENS="$WETH $USDC"
  APPROVED="WETH USDC"
  if [ "$CBBTC_UNITS" != "0" ]; then
    APPROVE_TOKENS="$APPROVE_TOKENS $CBBTC"
    APPROVED="$APPROVED cbBTC"
  fi
  for T in $APPROVE_TOKENS; do
    cast send "$T" "approve(address,uint256)" "$AQUA" "$(cast max-uint)" \
      --private-key "$KEY" --rpc-url "$RPC" > /dev/null
  done
fi

if [ -n "$ETH_TARGET" ]; then
  cast rpc anvil_setBalance "$ADDR" \
    "$(cast to-uint256 "$(cast to-wei "$ETH_TARGET" ether)")" --rpc-url "$RPC" > /dev/null
fi

bal() { cast call "$1" 'balanceOf(address)(uint256)' "$ADDR" --rpc-url "$RPC" | cut -d' ' -f1; }

echo "$ROLE $ADDR"
echo "  ETH    $(cast from-wei "$(cast balance "$ADDR" --rpc-url "$RPC")")"
echo "  WETH   $(cast from-wei "$(bal "$WETH")")"
echo "  USDC   $(cast from-wei "$(bal "$USDC")" 6)"
[ "$CBBTC_UNITS" != "0" ] && echo "  cbBTC  $(cast from-wei "$(bal "$CBBTC")" 8)"
[ -n "$APPROVED" ] && echo "  Aqua approved: $APPROVED"
exit 0
