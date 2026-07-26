import { NextResponse } from "next/server";
import { fetchUserBook } from "@sluice/arbitration-sdk/subgraph";

export const runtime = "nodejs";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export async function GET(request: Request) {
  const maker = new URL(request.url).searchParams.get("maker");
  if (!maker || !ADDRESS.test(maker)) {
    return NextResponse.json(
      { error: "maker must be a 0x address" },
      { status: 400 },
    );
  }
  try {
    return NextResponse.json(await fetchUserBook(maker));
  } catch (e) {
    // Subgraph down/unreachable → unavailable, not empty (Wiring §10). 503 so
    // the client renders `null`, never `[]`.
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 503 },
    );
  }
}
