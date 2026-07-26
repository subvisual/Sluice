# Design — 0G inference CLI (first F2 step)

**Date:** 2026-07-25 · **Branch:** `pf/f2-inference-cli` · **Feature:** [F2 — Private Recommendations](./README.md)

> **Note (post-write):** F2 later pivoted (decisions→recommendations,
> agent→user-as-maker). This
> spec describes the **inference CLI**, which is framing-agnostic and was built as designed; the
> downstream references below ("Issue 2", the framing codec, the old registry) belong to the old,
> since-cut plan.
> The live Gate 0 run also found the enclave signs an attestation record, not our text — see
> the Gate 0 note in the F2 README — and ran model `qwen/qwen2.5-omni-7b`, not the drafted `qwen-2.5-7b`
> in the config table below. Both are recorded; this doc is kept as the CLI's build record.

The first runnable slice of the 0G integration: a one-shot CLI that takes a free-form prompt,
runs it through a live 0G Compute provider, and prints the model's answer alongside a
**reproducible validation proof** (the enclave's out-of-band EIP-191 signature, the signer it
recovers to, and an independent proof URL). Running it successfully also satisfies the core
assertion of **Gate 0 / Issue 1** — a stable enclave signer — so it doubles as the gate.

This doc is the local, implementation-specific design for this one step.

## Goal

`npm run infer -- "your prompt"` → the 0G answer + a proof block a third party can re-verify.

Non-goal: everything else in F2. No framing/epoch codec, no mandate/validator, no REPL, no
web UI. Those are later issues.

## Where this sits in the F2 plan

- It is **Issue 1 (Gate 0)** made interactive: instead of a fixed dictated prompt, the operator
  types any prompt. The existing report-style spike (`spike/inference-spike.ts`) stays as-is —
  it additionally exercises the 3-line framing-compliance path this CLI deliberately skips.
- The reusable module it introduces (`src/inference.ts`) is the **seed of Issue 3**'s live
  sealed-inference client. Later issues extend it; this step ships only the round-trip +
  verification.

## Chosen approach: library-first

Extract the round-trip into a lean reusable module and put a thin CLI on top, rather than
adapting the one-shot spike in place. Barely more work, and it avoids re-inlining the round-trip
when Issue 3 arrives. The web dashboard (Issue 8) and the tick loop later import the same module.

## Components

The package `packages/arbitration-sdk` currently holds only `spike/`. This step scaffolds it.

### `src/inference.ts` — reusable round-trip

```ts
initBroker(wallet): Promise<ZGBroker>            // createZGComputeNetworkBroker
ensureLedgerFunded(broker, minZG): Promise<void> // depositFund if balance < min
infer(broker, prompt): Promise<InferResult>

type InferResult = {
  resultText: string        // assistant content shown to the user
  signedText: string        // exact bytes the enclave signed (may differ from resultText)
  signature: string         // EIP-191 personal_sign, fetched out-of-band
  signer: string | null     // ethers.verifyMessage(signedText, signature)
  chatID: string            // from ZG-Res-Key header
  latencyMs: number
  processResponseOk: boolean // broker.inference.processResponse agrees
  verified: boolean          // signer recovered (non-null) AND processResponseOk
  proofUrl: string           // GET {endpoint}/v1/proxy/signature/{chatID}?model={model}
}
```

`infer()` flow: `getServiceMetadata` → `getRequestHeaders` (single-use) →
POST `{endpoint}/chat/completions` → read `ZG-Res-Key` → GET the signature URL →
`ethers.verifyMessage(signedText, signature)` → `broker.inference.processResponse`.

The result the user reads is `resultText`; the proof is computed over `signedText` (the signed
bytes), which is what any downstream hashing/commit will use. This step only displays them — it
does not yet assert byte-identity or commit anything.

### `src/cli.ts` — one-shot entry (run via the `infer` npm script)

- Reads the prompt from `argv`, falling back to `stdin` (so `echo … | npm run infer` works).
- Loads config from `.env`; constructs the wallet.
- `initBroker` → `ensureLedgerFunded(broker, ZG_DEPOSIT)` → `infer(broker, prompt)`.
- Prints two blocks:

```
result: <resultText>

proof:
  signer      0x…            (registered? n/a at this step)
  verified    ✓ / ✗          (EIP-191 recover + processResponse)
  signature   0x…
  proof URL   https://<provider>/v1/proxy/signature/<chatID>?model=<model>
  chatID      …   latency <ms>ms
```

- Exit code `0` when `verified`, non-zero otherwise (a failed proof is a failed run).

### Scaffolding

- `package.json` — deps `ethers`, `@0gfoundation/0g-compute-ts-sdk`, `tsx`; script
  `"infer": "tsx src/cli.ts"`.
- `tsconfig.json` — matching the intended TS/Node toolchain.
- `.env` (gitignored) holds the funded key — never committed, per repo policy.

## Configuration (env, defaults match the spike)

| Var | Required | Default |
| --- | --- | --- |
| `ZG_PRIVATE_KEY` | yes | — (funded Galileo testnet key) |
| `ZG_RPC` | no | `https://evmrpc-testnet.0g.ai` |
| `ZG_PROVIDER` | no | `0xa48f01287233509FD694a22Bf840225062E67836` (qwen-2.5-7b) |
| `ZG_MODEL` | no | `qwen/qwen-2.5-7b-instruct` |
| `ZG_DEPOSIT` | no | `3` |

## Error handling

- Missing `ZG_PRIVATE_KEY` or empty prompt → clear message, non-zero exit, no network call.
- Network / SDK / signature-fetch failure → surface the underlying error, non-zero exit.
- Verification fails (signer null, or `processResponse` false) → print what was received, mark
  `verified ✗`, non-zero exit. The tool never claims a proof it doesn't have.

## Known unknown — the live SDK surface

This is the **first 0G code run in the repo**; Gate 0 has not actually executed yet. The spike's
own comments warn that the installed `@0gfoundation/0g-compute-ts-sdk` may expose different names
than drafted (`depositFund`, `getServiceMetadata`, `getRequestHeaders`, `processResponse`, and the
signature URL shape). Part of this work is: install the SDK, run against a live provider, and adapt
the calls to what is actually exposed. Requires a **funded Galileo testnet key and network
access** — the round-trip cannot be validated offline.

## Testing / validation

No unit-test harness this step (the value is the live round-trip, which needs a provider). Manual
acceptance:

- `npm run infer -- "…"` prints a non-empty result and `verified ✓` against a live provider.
- The printed proof URL, fetched independently, returns the same `{text, signature}`, and
  `ethers.verifyMessage` on them recovers the same signer across ≥3 runs (the Gate 0 assertion).
- Record the recovered signer and first latency back into the F2 plan, per Gate 0.

## Follow-ups (out of scope here, noted for the plan)

- Feed the recovered signer + latency into `docs/prds/f2-private-recommendations.md`.
- Later issues build the recommendation codec and validator atop this module.
