import { NextResponse } from "next/server";
import { composeForApp } from "@sluice/arbitration-sdk/serve";
import { REQUEST_DEFAULTS } from "@/lib/compose/constants";
import { parseComposeBody } from "@/lib/compose/parse-body";

/**
 * The one key-bearing endpoint. The body carries only what the user chose
 * (their words, their budget); limits are server policy (REQUEST_DEFAULTS),
 * never client input. Everything downstream of validation is the SDK facade,
 * which answers even without an enclave key — labelled TEMPLATE_FALLBACK, never
 * an error page.
 */

export const runtime = "nodejs";
// TEE inference is the slow path: up to 2 attempts at a few seconds each, plus
// the subgraph read. Vercel Hobby caps lower; Pro honours this.
export const maxDuration = 60;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return bad("body is not JSON");
  }

  const parsed = parseComposeBody(body);
  if (!parsed.ok) return bad(parsed.error);

  try {
    const result = await composeForApp({
      user: parsed.user,
      prompt: parsed.prompt,
      budget: parsed.budget,
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
