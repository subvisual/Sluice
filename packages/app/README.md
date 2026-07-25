# @sluice/app

The Compose screen — [Wiring §6](https://app.notion.com/p/3a8caae58631816d9aa0eb077e013ffe),
built against a stubbed composer (Track B item 2). Connect a wallet, type a sentence,
set a per-token budget, and see the exact request envelope and prompt that would go to
the enclave.

Nothing is sent, signed, or written to a chain. The screen stops at the assembled prompt.

## Run

```bash
npm run dev
```

From the repo root. Reads `NEXT_PUBLIC_RPC_URL` (see `.env.example`); defaults to
`http://127.0.0.1:8545`, i.e. an anvil fork of Base at the pinned block.

Balances read through that RPC, so without a fork running the picker shows
"balance unknown" — which never blocks building a request, deliberately.

## Layout

| Path | Owns |
| --- | --- |
| `src/lib/compose/` | The request envelope and prompt assembly. **No React** — this lifts into `packages/composer-sdk/` unchanged when that package exists. |
| `src/lib/compose/prompt.ts` | The six-section prompt contract, [F2 §9](https://app.notion.com/p/3a8caae5863181609acbcfd69a5db06b). |
| `src/lib/compose/grammar.ts` | The slot table, [F1 §5](https://app.notion.com/p/3a8caae5863181459491dcb6e7e25a1b). **Provisional** — F1 Q2 is open, so it is injected as data, not hardcoded. |
| `src/lib/compose/types.ts` | `RecommendationRequest`, F2 §5. |
| `src/components/` | The screen. |

Token addresses come from `config/addresses.8453.json` at the repo root — one file,
shared by the fork and by mainnet (F1 §1). Adding a token is a JSON edit.

## Not wired

Sealed inference (F2), the deterministic gate I1–I14 (F2 §6), market context and the
user's book (F3), and both transactions. `nonce` is a stand-in until
`RecommendationRegistry` is deployed, and is labelled as one on screen.
