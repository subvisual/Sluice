import { NextResponse } from "next/server";
import { fetchMakerPositions } from "@sluice/arbitration-sdk/subgraph";
import { toPositionDto } from "@/lib/position-from-subgraph";

/**
 * The dashboard's book read: every strategy the maker has shipped, ANY
 * status (docked and expired positions render too), straight from the F3
 * subgraph — with the program already decoded server-side (deadline, slot
 * rows, template match), since the decode pulls in ethers and must not reach
 * the client bundle. The client joins these rows against its local ship-time
 * metadata cache (`join-book.ts`) for the fields only a recommendation knows.
 */

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
    const rows = await fetchMakerPositions(maker);
    return NextResponse.json({ positions: rows.map(toPositionDto) });
  } catch (e) {
    // Subgraph down/unreachable → unavailable, not empty (Wiring §10). 503 so
    // the client renders `null`, never `[]`.
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 503 },
    );
  }
}
