import type { Address } from "viem";
import type { ServerBudgetEntry } from "@sluice/arbitration-sdk/serve";
import { tokenBy } from "../tokens";

/**
 * The compose endpoint's body validation, as a pure function.
 *
 * This is the ENFORCEMENT point, not the picker: the token list and the
 * two-token rule are server policy, and a disabled checkbox is an affordance.
 * It lives here rather than inline in the route handler because the app's test
 * suite is `tsx --test` over pure modules — there is no Next route-handler
 * harness, so validation written inline is validation nobody can test.
 *
 * Limits (maxStrategies, deadlines, retries) are NOT read from the body. They
 * are server policy in REQUEST_DEFAULTS.
 */
export type ParsedComposeBody =
  | { ok: true; user: string; prompt: string; budget: ServerBudgetEntry[] }
  | { ok: false; error: string };

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const BASE_UNITS = /^[0-9]+$/;

export function parseComposeBody(body: unknown): ParsedComposeBody {
  const b = body as {
    user?: unknown;
    prompt?: unknown;
    budget?: Array<{ address?: unknown; amount?: unknown }>;
  } | null;

  if (!b || typeof b !== "object") return bad("body must be a JSON object");
  if (typeof b.user !== "string" || !ADDRESS.test(b.user)) {
    return bad("user must be a 0x address");
  }
  if (typeof b.prompt !== "string" || b.prompt.trim() === "") {
    return bad("prompt must be a non-empty string");
  }
  if (!Array.isArray(b.budget)) return bad("budget must be an array");
  // One strategy is one pair, all the way down: swapvm takes two tokens,
  // MarketContext names one pair, pairingPlan splits it.
  if (b.budget.length !== 2) {
    return bad(`budget must name exactly 2 tokens, got ${b.budget.length}`);
  }

  const budget: ServerBudgetEntry[] = [];
  const seen = new Set<string>();
  for (const entry of b.budget) {
    if (typeof entry?.address !== "string" || !ADDRESS.test(entry.address)) {
      return bad("budget entries need a 0x token address");
    }
    const lower = entry.address.toLowerCase();
    if (seen.has(lower)) return bad(`duplicate token ${entry.address} in budget`);
    seen.add(lower);

    const meta = tokenBy(entry.address as Address);
    if (!meta) return bad(`token ${entry.address} is not in the token list`);

    if (
      typeof entry.amount !== "string" ||
      !BASE_UNITS.test(entry.amount) ||
      BigInt(entry.amount) === 0n
    ) {
      return bad(
        `amount for ${meta.symbol} must be a positive base-unit integer string`,
      );
    }

    budget.push({
      address: meta.address,
      symbol: meta.symbol,
      decimals: meta.decimals,
      amount: entry.amount,
    });
  }

  return { ok: true, user: b.user, prompt: b.prompt, budget };
}

const bad = (error: string): ParsedComposeBody => ({ ok: false, error });
