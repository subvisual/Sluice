import { formatUnits, type Address } from "viem";
import {
  BAND,
  COMPAT_RULES,
  CURVES,
  DEADLINE,
  TEMPLATES,
  WRAPPERS,
  type InstructionSpec,
  type Template,
} from "../../../../arbitration-sdk/src/grammar.ts";
import { PROMPT_VERSION, RECOMMENDATION_SCHEMA } from "./constants";
import type {
  ComposePrompt,
  MarketContext,
  RecommendationRequest,
  TokenMeta,
  ViolationRecord,
} from "./types";

/**
 * The prompt contract — F2 §9.
 *
 * The enclave signs whatever it returns, so the prompt is part of the security
 * surface. Six sections, in this order:
 *
 *   SYSTEM     role, the instruction menu and its compatibility rules, the
 *              output schema, and the rule that a response failing schema or
 *              validation is rejected and retried
 *   REQUEST    the user's prompt verbatim, their selected tokens and amounts,
 *              maxStrategies, maxDeadlineSec
 *   CONTEXT    market data and the user's existing book (F3)
 *   TEMPLATES  the seed shapes with the intent each serves
 *   HISTORY    violations from previous attempts THIS request, if any
 *   TASK       return ONLY the two fixed prefix lines plus the JSON body
 *
 * The grammar itself — instructions, rules, templates — is IMPORTED from
 * `arbitration-sdk/src/grammar.ts`, the one place it lives. Every name it
 * mentions resolves against the pinned opcode table of the deployed router, so
 * this prompt cannot describe an instruction the venue cannot run. (The
 * provisional six-slot grammar this module used to inject was replaced in
 * PR #15; do not reintroduce it.)
 *
 * Pure and React-free on purpose: this module lifts into
 * `packages/composer-sdk/src/` unchanged once that package exists.
 */

export type ComposePromptInput = {
  request: RecommendationRequest;
  /** Metadata for every token in `request.budget`, so amounts render readably. */
  tokens: TokenMeta[];
  /** Per-user replay counter — `nonceOf[user] + 1` (I13). */
  nonce: number;
  /** F3. `null` renders as an explicit "unavailable", never as invented numbers. */
  context: MarketContext | null;
  /** Carried forward across retries. Only violation history carries forward — F2 §4. */
  history?: ViolationRecord[];
};

export function buildComposePrompt(input: ComposePromptInput): ComposePrompt {
  return {
    promptVersion: PROMPT_VERSION,
    system: systemSection(input.request),
    user: [
      requestSection(input.request, input.tokens),
      contextSection(input.context),
      templatesSection(TEMPLATES),
      historySection(input.history ?? []),
      taskSection(input.request, input.nonce, input.context !== null),
    ].join("\n\n"),
  };
}

/* ------------------------------------------------------------------ SYSTEM */

const renderMenu = (list: InstructionSpec[]) =>
  list
    .map(
      (i) =>
        `    ${i.name} — ${i.summary}${i.params ? `\n        params: ${i.params}` : ""}`,
    )
    .join("\n");

function systemSection(request: RecommendationRequest) {
  const rules = COMPAT_RULES.map((r, i) => `  R${i + 1}. ${r}`).join("\n");

  return `You compose market-making strategies for 1inch Aqua's SwapVM, on behalf of a
user who described what they want in one sentence and declared a budget.

You do not write bytecode. You choose which instructions fill a fixed program
shape, and their parameters. Instruction ORDER in SwapVM is security-critical,
and our compiler owns it — mis-ordering is not something you can express, so do
not try to express it.

THE INSTRUCTION MENU — this is the COMPLETE menu; nothing else exists on this venue
  required on every strategy:
${renderMenu([DEADLINE])}
  optional band (MUST come before the fee and the curve):
${renderMenu([BAND])}
  optional wrappers (MUST come before the curve):
${renderMenu(WRAPPERS)}
  curve (EXACTLY ONE, and it goes LAST):
${renderMenu(CURVES)}

You do NOT choose a salt — the compiler emits one on every strategy.

COMPATIBILITY RULES — these are enforced deterministically after you answer
${rules}

WHAT HAPPENS TO YOUR ANSWER
Your response is checked by deterministic code before a human ever sees it. It
is never edited. A response that fails JSON-schema validation or violates any
rule above is REJECTED WHOLE, and you are asked again with the violation named.
After ${request.maxInferenceRetries} retries the user is shown a template default
instead of anything you produced. Complying on the first attempt is the only
outcome that serves them — a retry is a full round trip that a person is sitting
and waiting through.

Strategies are IMMUTABLE once shipped. There is no patching a bad
recommendation; the only exit is dock() plus a fresh ship(). Size accordingly.

OUTPUT
Return the two fixed prefix lines and then a JSON body, and nothing else. No
markdown fences, no commentary, no reasoning, no tool calls. Prose explaining
your choice is collected separately and must not appear here.`;
}

/* ----------------------------------------------------------------- REQUEST */

function requestSection(request: RecommendationRequest, tokens: TokenMeta[]) {
  const budgetLines = Object.entries(request.budget).map(([addr, amount]) => {
    const token = tokens.find(
      (t) => t.address.toLowerCase() === addr.toLowerCase(),
    );
    const readable = token
      ? ` (= ${formatUnits(amount, token.decimals)} ${token.symbol})`
      : "";
    const meta = token ? `${token.symbol}, ${token.decimals} decimals` : "unknown token";
    return `  - ${addr} [${meta}]\n    ceiling: ${amount.toString()} base units${readable}`;
  });

  return `## REQUEST

The user's own words, verbatim:
"""
${request.prompt}
"""

Wallet: ${request.user}
Chain:  ${request.chainId}

BUDGET — tokens this user selected, and the ceiling they set for each.
Base units are authoritative; the readable amount is for your understanding only.
${budgetLines.join("\n")}

You may commit these tokens and no others, up to these ceilings and no further.
Across ALL strategies you return, the per-token total must not exceed the
ceiling. If you return more than one strategy, DIVIDE the budget between them —
do not give each strategy the full amount.

Limits:
  maxStrategies:  ${request.maxStrategies}
  maxDeadlineSec: ${request.maxDeadlineSec} (every deadline must fall inside now + this)`;
}

/* ----------------------------------------------------------------- CONTEXT */

function contextSection(context: MarketContext | null) {
  if (!context) {
    return `## CONTEXT

Unavailable — market data and this wallet's existing book are not wired into
this request.

Do not invent pool depth, realised volatility, fee tiers or existing positions,
and do not reason as though you had them. Where a choice would depend on
realised volatility you do not have, prefer the conservative option and keep
band widths wide rather than guessing narrow.`;
  }

  const pair = context.pair;
  const market = pair
    ? `Pair:              ${pair.tokens[0]} / ${pair.tokens[1]}
  fee tier:        ${pair.feeTierBps ?? "unknown"} bps
  pool depth:      ${pair.poolDepthUsd ?? "unknown"}
  realised vol 1h: ${pair.realizedVol1h ?? "unknown"}
  realised vol 24h:${pair.realizedVol24h ?? "unknown"}
  volume 24h:      ${pair.volume24hUsd ?? "unknown"}`
    : "Market data for this pair: unavailable. Do not invent it.";

  const book =
    context.book === null
      ? "This wallet's existing book: unavailable. Do not assume it is empty."
      : context.book.length === 0
        ? "This wallet has no strategies currently shipped."
        : context.book
            .map(
              (p) =>
                `  - ${p.strategyHash} template=${p.templateId}\n    tokens=${p.tokens.join(",")} virtual=${p.virtualAmounts.join(",")} consumed=${p.consumed.join(",")} deadline=${p.deadline}`,
            )
            .join("\n");

  return `## CONTEXT

Observed at block ${context.observedBlock} (unix ${context.observedAt}).
Copy both of these into your response body verbatim.

${market}

ALREADY SHIPPED BY THIS WALLET
${book}`;
}

/* --------------------------------------------------------------- TEMPLATES */

function templatesSection(templates: Template[]) {
  const body = templates
    .map(
      (t) =>
        `### ${t.label}
  templateId:  ${t.id}
  serves:      "${t.describesIntent}"
  shape:       ${[...t.wrappers, t.curve].join(" + ")} — ${t.shape}`,
    )
    .join("\n\n");

  return `## TEMPLATES

Known-good starting shapes, not menu items. Pick the one whose intent is closest
to what the user asked for and parameterise it within the grammar. Every
strategy you return must carry the templateId of the shape that seeded it, so
its provenance is on the record.

${body}`;
}

/* ----------------------------------------------------------------- HISTORY */

function historySection(history: ViolationRecord[]) {
  if (history.length === 0) {
    return `## HISTORY

First attempt for this request.`;
  }

  const lines = history
    .map((v) => `  - attempt ${v.attempt}, ${v.invariant}: ${v.message}`)
    .join("\n");

  return `## HISTORY

Your previous attempts at THIS request were rejected:
${lines}

The market context above has been re-read since then — use the values in this
prompt, not the ones you were given before. Fix the violations named; do not
change anything else.`;
}

/* -------------------------------------------------------------------- TASK */

function taskSection(
  request: RecommendationRequest,
  nonce: number,
  hasContext: boolean,
) {
  const [line0, line1] = prefixLines(request.user, request.chainId, nonce);

  // With no snapshot there is nothing to copy, and inventing a block number is
  // worse than admitting there is none: I12 checks observedBlock against head,
  // so a fabricated value would be a staleness guard evaluated against fiction.
  const observed = hasContext
    ? `  "observedAt": <unix seconds, copied from CONTEXT>,
  "observedBlock": <block number, copied from CONTEXT>,`
    : `  "observedAt": null,
  "observedBlock": null,`;

  const observedNote = hasContext
    ? `Copy "observedAt" and "observedBlock" from CONTEXT exactly. Do not compute
them, and do not substitute the current time.`
    : `CONTEXT carried no snapshot, so "observedAt" and "observedBlock" are both
null. Do not invent a block number or a timestamp for them.`;

  return `## TASK

Return exactly these two lines first, character for character:

${line0}
${line1}

Then, from line 3 onward, the JSON body. It must be valid JSON — no markdown
fence, and no comments. Angle brackets below mark where a value goes.

{
${observed}
  "strategies": [
    {
      "templateId": "<a template id from TEMPLATES>",
      "slots": {
        "band":     { "instruction": "${BAND.name}", "params": { "bandBps": <integer> } },
        "fee":      { "instruction": "${WRAPPERS[0].name}", "params": { "feeBps": <integer> } },
        "curve":    { "instruction": "<the curve>" },
        "deadline": { "deadline": <unix seconds> }
      },
      "tokens": ["<address>", ...],
      "virtualAmounts": ["<decimal string, base units>", ...]
    }
  ]
}

Between 1 and ${request.maxStrategies} strategies.

"band" and "fee" are the two optional slots: OMIT THE KEY ENTIRELY when the
slot is unused. Never send it as null or as an empty object. For the band you
choose "bandBps" ONLY — the compiler derives the concentration deltas; never
emit deltas.

"tokens" are in canonical ASCENDING address order, and "virtualAmounts" are
positionally matched to them — DECIMAL STRINGS in base units. Never a JSON
number: a large amount through a float loses precision silently, and this is a
signed artifact.

${observedNote}

Return the two prefix lines and the JSON body. Nothing before them, nothing
after them.`;
}

/**
 * The two fixed lines the model copies — F2 §3.
 *
 * Line 0 binds schema version and chainId into the signed bytes. Line 1 is
 * fixed-width: 40 hex characters of address (no 0x) then a 20-digit
 * zero-padded nonce.
 *
 * ⚠️ These were designed to be read on-chain by fixed offset (`_prefixOf`).
 * The Gate 0 run on 2026-07-25 found that 0G signs its OWN 5-field attestation
 * record, not our text — so there is no prefix for the registry to parse and
 * that mechanism needs redesign (F2 §2, open). The wire format is kept because
 * it is still the documented shape of the model's output and still carries
 * user+nonce into the trace; only the on-chain parse is in question.
 */
export function prefixLines(
  user: Address,
  chainId: number,
  nonce: number,
): [string, string] {
  return [
    `${RECOMMENDATION_SCHEMA};chain=${chainId}`,
    `${user.slice(2).toLowerCase()}${String(nonce).padStart(20, "0")}`,
  ];
}

export { PROMPT_VERSION };
