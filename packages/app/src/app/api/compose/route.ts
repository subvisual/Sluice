import { NextResponse } from "next/server";
import type { Address } from "viem";
import {
  composeForApp,
  type ServerBudgetEntry,
} from "@sluice/arbitration-sdk/serve";
import { REQUEST_DEFAULTS } from "@/lib/compose/constants";
import { tokenBy } from "@/lib/tokens";

/**
 * The one key-bearing endpoint. The body carries only what the user chose
 * (their words, their budget); limits are server policy (REQUEST_DEFAULTS),
 * never client input. Everything downstream of validation is the SDK facade,
 * which answers even without an enclave key — labelled TEMPLATE_FALLBACK,
 * never an error page (design decision 3).
 */

export const runtime = "nodejs";
// TEE inference is the slow path: up to 2 attempts at a few seconds each,
// plus the subgraph read. Vercel Hobby caps lower; Pro honours this.
export const maxDuration = 60;

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const BASE_UNITS = /^[0-9]+$/;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return bad("body is not JSON");
  }
  const b = body as {
    user?: unknown;
    prompt?: unknown;
    budget?: Array<{ address?: unknown; amount?: unknown }>;
  };

  if (typeof b.user !== "string" || !ADDRESS.test(b.user)) {
    return bad("user must be a 0x address");
  }
  if (typeof b.prompt !== "string" || b.prompt.trim() === "") {
    return bad("prompt must be a non-empty string");
  }
  if (!Array.isArray(b.budget) || b.budget.length === 0) {
    return bad("budget must be a non-empty array");
  }

  const budget: ServerBudgetEntry[] = [];
  for (const entry of b.budget) {
    if (typeof entry?.address !== "string" || !ADDRESS.test(entry.address)) {
      return bad("budget entries need a 0x token address");
    }
    const meta = tokenBy(entry.address as Address);
    if (!meta) {
      return bad(`token ${entry.address} is not in the token list`);
    }
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

  try {
    const result = await composeForApp({
      user: b.user,
      prompt: b.prompt,
      budget,
      maxStrategies: REQUEST_DEFAULTS.maxStrategies,
      maxDeadlineSec: REQUEST_DEFAULTS.maxDeadlineSec,
    });
    return NextResponse.json(result);
  } catch (e) {
    // The facade converts expected failures into labelled fallbacks; reaching
    // here is a bug, and it should look like one.
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}
