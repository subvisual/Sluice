"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Address, Hex } from "viem";

/**
 * The user's book — every strategy this wallet has shipped.
 *
 * The real source is the F3 book subgraph, which is not wired yet. Until it
 * is, the book lives in memory for the session: it starts empty and grows when
 * the user ships a recommendation. That makes `[]` honest here — this build's
 * book genuinely holds nothing it hasn't seen shipped.
 *
 * `null` is reserved for the subgraph read: it means "unknown", and the
 * dashboard must render it as unavailable, never as "no positions" (Wiring
 * §10). Keep the distinction when F3 lands.
 */

export type RiskRating = "low" | "medium" | "high";

/** Who produced the recommendation this position came from — F2 §4. */
export type Provenance = "ENCLAVE" | "TEMPLATE_FALLBACK";

export type PositionLeg = {
  token: Address;
  symbol: string;
  decimals: number;
  /** The ceiling the user authorised — never a balance, never a transfer. */
  virtual: bigint;
  consumed: bigint;
};

/** One executed fill, as the subgraph will hand it over (display strings). */
export type Fill = { time: string; flow: string };

export type SlotRow = {
  index: number;
  name: string;
  instruction: string;
  params: string;
};

export type Position = {
  /** `strategyHash` keys the position on-chain; unique enough for the UI. */
  id: string;
  strategyHash: Hex;
  /** e.g. "WETH / USDC" — the market pair, not the committed tokens. */
  pair: string;
  /** `TEMPLATES[].label` minus the `T1 · ` prefix. */
  templateLabel: string;
  /** From the recommendation, not generated client-side. */
  description: string;
  bandKind: "band" | "level";
  band: string;
  bandNote: string;
  legs: PositionLeg[];
  fills: Fill[];
  /** Unix seconds. At expiry the position unwinds automatically. */
  deadline: number;
  /** Unix seconds; set when the user docks. Docked hashes are burned forever. */
  dockedAt: number | null;
  /** Absent rating renders "risk rating unavailable" — never a number. */
  risk: RiskRating | null;
  provenance: Provenance;
  slots: SlotRow[];
};

export type PositionStatus = "Live" | "Expired" | "Docked";

export function positionStatus(p: Position, nowSec: number): PositionStatus {
  if (p.dockedAt !== null) return "Docked";
  return p.deadline <= nowSec ? "Expired" : "Live";
}

type BookValue = {
  /** `null` = book unknown (subgraph unavailable) — NOT the same as empty. */
  positions: Position[] | null;
  ship: (positions: Position[]) => void;
  dock: (id: string) => void;
};

const BookContext = createContext<BookValue | null>(null);

export function BookProvider({ children }: { children: ReactNode }) {
  const [positions, setPositions] = useState<Position[]>([]);

  const ship = useCallback((next: Position[]) => {
    setPositions((prev) => [...next, ...prev]);
  }, []);

  const dock = useCallback((id: string) => {
    const now = Math.floor(Date.now() / 1000);
    setPositions((prev) =>
      prev.map((p) => (p.id === id ? { ...p, dockedAt: now } : p)),
    );
  }, []);

  const value = useMemo(() => ({ positions, ship, dock }), [positions, ship, dock]);

  return <BookContext.Provider value={value}>{children}</BookContext.Provider>;
}

export function useBook(): BookValue {
  const value = useContext(BookContext);
  if (!value) throw new Error("useBook requires a BookProvider");
  return value;
}
