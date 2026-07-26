import type { Position, PositionLeg } from "./book";

/**
 * The wire shape of a position as `GET /api/book` returns it: exactly a
 * `Position`, with the bigint leg amounts as raw base-unit strings (JSON has
 * no bigint). Client-safe on purpose — no SDK import, no ethers.
 */

export type PositionLegDto = Omit<PositionLeg, "virtual" | "consumed"> & {
  virtual: string;
  consumed: string;
};

export type PositionDto = Omit<Position, "legs"> & { legs: PositionLegDto[] };

export function revivePosition(dto: PositionDto): Position {
  return {
    ...dto,
    legs: dto.legs.map((leg) => ({
      ...leg,
      virtual: BigInt(leg.virtual),
      consumed: BigInt(leg.consumed),
    })),
  };
}
