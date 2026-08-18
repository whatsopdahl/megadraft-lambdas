import type { Draft } from "./types.js";

/**
 * Builds the full pick-order list of fantasyTeamIds for one round.
 * "snake" reverses direction each round when consumed via
 * teamIdForPick below; "linear" repeats the same order every round.
 */
export function baseRoundOrder(teamIds: string[]): string[] {
  return [...teamIds];
}

/** Returns the fantasyTeamId on the clock for a given 1-indexed pick number. */
export function teamIdForPick(draft: Pick<Draft, "pickOrderTeamIds" | "orderType">, pickNumber: number): string {
  const teamCount = draft.pickOrderTeamIds.length;
  if (teamCount === 0) {
    throw new Error("Draft has no teams");
  }

  const zeroIndexedPick = pickNumber - 1;
  const round = Math.floor(zeroIndexedPick / teamCount);
  const slotInRound = zeroIndexedPick % teamCount;

  const reversed = draft.orderType === "snake" && round % 2 === 1;
  const index = reversed ? teamCount - 1 - slotInRound : slotInRound;

  return draft.pickOrderTeamIds[index];
}
