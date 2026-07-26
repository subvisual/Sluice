---
name: fork-ship-and-fill
description: Run Sluice end to end against a local Base fork — compose a recommendation, choose strategies, ship them in one signature, then drive a taker swap on the SwapVM router so a shipped strategy actually fills and its inventory moves. Use when asked to test/demo/rehearse the app on the fork, to check the compose→ship path, to trigger a fill, or to see a strategy change after a swap.
---

# Ship on the fork, then fill it

Sluice's loop is only real when a strategy **fills** — a shipped position is a
promise until a taker draws on it, and a fork has no organic takers, so the fill
is one you produce. This runs the whole thing: sentence → recommendation →
choice → one signature → a swap that moves the maker's tokens.

**Never point any of this at mainnet.** Every script here probes `anvil_nodeInfo`
or talks to `127.0.0.1:8545`. A fork shares Base's chainId (8453), so chainId
proves nothing — the probe is the guard.

## 0. Preflight

```bash
anvil --version && node --version && cast --version
```

The enclave path needs `ZG_PRIVATE_KEY` in `packages/app/.envrc` **and** a funded
0G compute ledger. Without the key (or with an unfunded ledger) every compose
returns a `TEMPLATE_FALLBACK` with **one** strategy — the flow still works, but
there is nothing to choose between, which defeats half the point. Check:

```bash
npm --prefix packages/arbitration-sdk run fund
```

`ledger available: 3.0 OG` (or similar) means inference will run. `ledger: none
yet` means it creates one — **that moves testnet funds, so ask the user first.**

## 1–3 in one command

```bash
scripts/demo-up.sh
```

Fork at the pinned block, the local index over it, the demo wallet funded and
approved, the app up with that wallet connected — steps 1 to 3 below, in the one
order that works, plus §6's index. Use it unless you need a step changed; the
rest of this file is what it does and why. Ctrl-C stops only the app;
`scripts/demo-down.sh` stops the app, the fork and the index together.

Then add the taker, which the demo wallet alone cannot be:
`scripts/fork-fund.sh taker`. Skip to §4.

## 1. Fork

```bash
anvil --fork-url https://mainnet.base.org --fork-block-number 49100000 --port 8545
```

Pinned block, from `config/addresses.8453.json` — the venue must not drift
between rehearsal and demo. Run it in the background and leave it up; every step
below shares this state.

## 2. Fund both sides

```bash
scripts/fork-fund.sh maker    # or `demo`: 100 ETH, 10 WETH, 1000 USDC, 1 cbBTC
scripts/fork-fund.sh taker
```

Maker is anvil account 0 (ships), taker is account 1 (fills) — deliberately
different addresses. `demo` is the maker address again with a fuller sheet; a
role here names a balance sheet, not a wallet. No token has a faucet on a fork,
so balances are written into the balance slot, and every amount is a target: run
it twice and you hold what it says, not double.

This also approves Aqua for the maker's tokens. **That approval is what makes a
shipped position fillable** — Aqua pulls the real ERC20 only at fill time. See
the troubleshooting note; it is the failure you will actually hit.

Worth knowing before it costs you an afternoon: **anvil's accounts 0 and 1 carry
an EIP-7702 delegation on real Base** — their keys are public, someone set one,
and a fork inherits it. They have CODE. `WETH.withdraw()` pays out through a
2300-gas `transfer`, the stipend runs the delegate, and it reverts with a bare
`0x`: these accounts can wrap but never unwrap.

## 3. App

`packages/app/.envrc` needs `NEXT_PUBLIC_DEV_ACCOUNT` set to the maker address,
which puts a "Connect fork account" button in the header — it forwards
`eth_sendTransaction` to anvil, which signs with its own unlocked key. There is
no browser wallet in a headless run, and without a `NEXT_PUBLIC_REOWN_PROJECT_ID`
there is no connect button at all.

```bash
set -a; . ./packages/app/.envrc; set +a
npm run dev
```

Add `NEXT_PUBLIC_DEV_AUTOCONNECT=1` (what `demo-up.sh` does) to connect on load
instead of on a click and to **pin the read path to the fork**. Without the pin,
a `sluice-rpc=mainnet` cookie left in the browser from any earlier session sends
the page to Base — empty wallet, someone else's book, both venues chainId 8453,
nothing on screen admitting it.

## 4. Walk the UI

Open `http://localhost:3000`. Drive it in the browser — the point is to exercise
what a judge will click, not to bypass it.

1. **New strategy.** Type an intent that asks for options, e.g. *"Make a market
   on WETH/USDC for the next week. Show me a tight option and a wider one so I
   can compare."*
2. **Budget.** Tick WETH and USDC, set e.g. `1` and `3000`. Balances are read
   live off the fork; the budget is a ceiling, not a transfer.
3. **Compose.** ~10–45s for the enclave round trip. Expect `✓ ENCLAVE`, a
   verified signer, and `book · live from the aqua subgraph`.
4. **Choose.** Every card arrives selected. Drop some. The bar tracks it live —
   `1 of 3 ship in a single Multicall` — and states the true transaction count.
5. **Ship.** One signature when Aqua is already approved (step 2 did that).

Driving the page from the agent: click via refs from `read_page`, or
`document.querySelector` + `.click()`. Screenshot coordinates are unreliable —
the screenshot is scaled relative to the viewport. Fill React inputs through the
native setter and dispatch an `input` event, or the value will not stick:

```js
const set = (el, v) => {
  Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
```

Verify the ship on chain rather than trusting the screen:

```bash
cast logs --from-block 49100000 --address $(jq -r .aqua config/addresses.8453.json) \
  --rpc-url http://127.0.0.1:8545
```

One `Shipped` per strategy you kept, and **none** for the ones you dropped. The
whole set goes out in one transaction.

## 5. Fill it — the part that makes it real

```bash
node scripts/fork-take.mjs --maker 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 --in USDC --amount 200
```

- Recovers the order from the `Shipped` event rather than rebuilding it —
  rebuilding is how the bytes drift and the swap reverts for an unrelated-looking
  reason. It targets the **newest** shipped strategy, or `--hash 0x…`.
- Quotes immediately before swapping and compares. A divergence is printed, not
  inferred.
- `--in WETH --amount 0.05` fills the other direction.

Expect quote and fill to agree exactly, and the balance table to show the maker's
wallet changing. **Ship moves nothing; the fill is when tokens move.** That is
the claim the whole product rests on — show it.

## 6. Seeing the fill on the dashboard (the local index)

The book is a JOIN of subgraph data with a local metadata cache. Against the
**deployed** Base subgraph there is no record of a fork transaction, so after a
real fill the card still reads `consumed 0` — not a bug, and not evidence of
anything. To make it move you need a subgraph indexing *this* fork.

Do this **before** the walkthrough — it indexes from the fork block forward.
`scripts/demo-up.sh` already has (both of these steps), so skip ahead.

```bash
subgraph/local/fork-up.sh          # FORK_BLOCK=<n> pins it; default is the head
```

Then point the app at it (the whole app, not just the route):

```bash
SLUICE_SUBGRAPH_URL=http://localhost:8000/subgraphs/name/sluice/aqua-local npm run dev
```

After a fill the card shows `0.0794 consumed of 0.3333` with a progress bar,
while the strategies you dropped stay at `0.0000`. Verified end to end.

Four things that will bite, in the order they bit:

1. **`docker compose` v2 must exist** — `docker compose version`. It is a plugin,
   separate from the docker CLI. On macOS/Homebrew: `brew install docker-compose`
   then symlink it where docker looks:
   `ln -sf /opt/homebrew/lib/docker/cli-plugins/docker-compose ~/.docker/cli-plugins/`.
2. **anvil must bind `0.0.0.0`.** graph-node is in a container and reaches the
   chain over `host.docker.internal`; a loopback-only anvil refuses it. The only
   symptom is `unable to fetch genesis` in the graph-node log and an index that
   never advances. `fork-up.sh` now starts anvil correctly and warns about an
   existing loopback-only one — but if you started anvil yourself, restart it
   with `--host 0.0.0.0`.
3. **The first deploy can `ECONNRESET`** while graph-node warms up (the image is
   amd64 and runs emulated on Apple silicon, so everything is slow). The node has
   usually accepted the deploy anyway. `fork-up.sh` retries once; confirm with
   `curl localhost:8030/graphql -d '{"query":"{ indexingStatuses { health } }"}'`
   rather than trusting the CLI's error.
4. **Do not read the index too early.** Query `_meta { block { number } }` and
   compare it to `cast block-number` before concluding a fill was missed. An
   index that is two blocks behind looks exactly like a broken handler.

Useful query — strategy inventory and fills straight from the index:

```bash
curl -s http://localhost:8000/subgraphs/name/sluice/aqua-local \
  -H 'content-type: application/json' \
  -d '{"query":"{ _meta { block { number } } strategies { strategyHash fillCount balances { token { id } initialVirtual virtualBalance totalPulled } } }"}'
```

## Troubleshooting

**`swap` reverts with `0xf4059071` while `quote()` succeeds.** The maker has not
approved Aqua for the token being bought. Aqua's `pull` calls `transferFrom` on
the maker and it reverts; the curve was never the problem. `scripts/fork-take.mjs`
checks this up front and names it. Re-approve with `scripts/fork-fund.sh maker`.
Worth knowing: an unrelated session sharing the fork can revoke an allowance out
from under you.

**Compose returns `TEMPLATE_FALLBACK` with one strategy.** Either no
`ZG_PRIVATE_KEY`, or the ledger is unfunded, or the gate rejected the model. The
`reason` field says which, and names the invariants (e.g. `I2`) when it was the
gate. An I2 rejection with huge amounts means the model emitted base units —
check the units rules in `grammar.ts` and `PROMPT_VERSION`.

**"Waiting for your wallet client to be ready…"** on the ship button — the
connector resolves a moment after connecting. It clears on its own.

**The card says `0.00% maker fee`.** Known display defect, issue #44 — a zero or
sub-0.005% fee renders as nothing. Not a fill problem.
