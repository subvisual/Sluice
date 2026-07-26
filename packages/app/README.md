# @sluice/app

The Compose screen — [Wiring §6](https://app.notion.com/p/3a8caae58631816d9aa0eb077e013ffe).
Connect a wallet, type a sentence, set a per-token budget, and get back an
Aqua/SwapVM strategy recommendation from the enclave path (`/api/compose`) — real
when the server holds a funded 0G key, labelled `TEMPLATE_FALLBACK` otherwise.
Risk ratings arrive with the deferred reviewer (F2 Gate 2); until then the UI
shows "risk rating unavailable".

Accepting a recommendation builds the ship `Multicall` the user signs (PR #34);
the dashboard reads the wallet's shipped strategies back from the subgraph (PR #35).

## Run

```bash
npm run dev
```

From the repo root. Env lives in `.envrc` (see `.env.example` for the shape).

Balances read through the selected RPC, so without a fork running the picker shows
"balance unknown" — which never blocks building a request, deliberately.

## Wallet & network

Wallet connection is **Reown AppKit** (multi-wallet modal: extension wallets +
WalletConnect QR) behind `NEXT_PUBLIC_REOWN_PROJECT_ID` — absent, the header shows
a note instead of a connect button and everything else still works. AppKit's
adapter requires **wagmi 2.x**; don't bump wagmi to 3 until AppKit supports it
(`next.config.ts` carries two build workarounds pinned to this, each commented
with its delete-when condition).

The header dropdown switches the app's **read path** between the local anvil fork
(`NEXT_PUBLIC_RPC_URL`, default `http://127.0.0.1:8545`) and Base mainnet
(`NEXT_PUBLIC_BASE_RPC_URL`, default `https://mainnet.base.org`). The choice
persists in a `sluice-rpc` cookie — a cookie, not localStorage, because the
server needs it too (`layout.tsx` builds the wagmi config for
`cookieToInitialState`, and the rail's network label is SSR'd) — and switching
reloads the page: the wagmi/AppKit config is built once per load, deliberately.

Both modes are chainId **8453** (the fork shares Base's chainId), so the dropdown
is **not a mainnet guard** — that stays with the anvil probe +
`SLUICE_ALLOW_MAINNET` on whatever signs. Two caveats in fork mode, surfaced in
the UI: an injected wallet signs via its *own* Base RPC entry (repoint it at the
anvil URL to rehearse against the fork), and WalletConnect/mobile wallets cannot
reach `127.0.0.1` — fork mode is extension-only.

## Layout

| Path | Owns |
| --- | --- |
| `src/lib/compose/` | The request envelope: building it from user input, the client-side checks that run before it, and mapping the server's response onto what the screen renders. **No React**. Prompt assembly itself lives server-side, in the SDK's `buildComposeMessages` behind `/api/compose` (below) — not here. |
| `src/lib/compose/request.ts` | `buildRecommendationRequest` — the request envelope and the checks the client can honestly make before spending a round trip. |
| `src/lib/compose/from-server.ts` | Maps `ServerComposeResult` onto the UI shapes. Labels resolve through the SDK's own `TEMPLATES` so the two sides cannot drift. |
| `src/lib/compose/types.ts` | `RecommendationRequest`, F2 §5. |
| `src/components/` | The screen. |

Token addresses come from `config/addresses.8453.json` at the repo root — one file,
shared by the fork and by mainnet (F1 §1). Adding a token is a JSON edit.

## Not wired

Sealed inference and the deterministic gate are wired via `/api/compose` (below):
real, signed `ENCLAVE` recommendations when the server holds a key, otherwise the
deterministic `TEMPLATE_FALLBACK` seed. Still not wired: market/pair context beyond
the user's own book (F3 job 2). `nonce` is a fixed field of the recommendation
payload schema.

## /api/compose — the server-side enclave path

The compose screen posts `{ user, prompt, budget }` to `POST /api/compose`
(Node runtime, `maxDuration: 60`). The route runs the arbitration-sdk facade:
live book context from the subgraph, sealed 0G inference with one retry, the
deterministic validator — and returns the recommendation with its provenance.

- With `ZG_PRIVATE_KEY` set (see `.env.example`): real, signed `ENCLAVE`
  recommendations. Fund the wallet at faucet.0g.ai and the compute ledger via
  `npm run fund` in `packages/arbitration-sdk` (once, out-of-band — the route
  never funds).
- Without it: the deterministic template seed, always labelled
  `TEMPLATE_FALLBACK` with the reason. The demo never dies on a missing key.

On Vercel: set the `ZG_*` vars as server env vars (never `NEXT_PUBLIC_`);
`maxDuration: 60` needs a plan that allows it.

The route is **unauthenticated**: anyone who can reach it spends the 0G compute
ledger (and up to 60s of server time) per call. Fine locally; before sharing a
deployed URL, put a same-origin check or a rate limit in front so the ledger
cannot be drained from a link an hour before the demo.
