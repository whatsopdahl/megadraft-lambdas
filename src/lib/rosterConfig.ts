import type { Player, SportLeague } from "./types.js";

// The only positions syncEspnPlayers actually writes to the Players table -
// ESPN's raw position maps include bench/IR/combo/IDP codes that are never
// synced, so a roster slot for those would never be fillable.
export const ROSTER_POSITIONS: Record<SportLeague, string[]> = {
  NBA: ["PG", "SG", "SF", "PF", "C"],
  NFL: ["QB", "RB", "WR", "TE", "K", "D/ST"],
};

export interface LeagueRosterConfig {
  positions: Record<string, number>;
  bench: number;
}

export interface RosterConfig {
  NBA: LeagueRosterConfig;
  NFL: LeagueRosterConfig;
}

export function computeTotalRounds(rosterConfig: RosterConfig): number {
  return (Object.keys(ROSTER_POSITIONS) as SportLeague[]).reduce((sum, league) => {
    const leagueConfig = rosterConfig[league];
    const positionsSum = Object.values(leagueConfig.positions).reduce((s, n) => s + n, 0);
    return sum + positionsSum + leagueConfig.bench;
  }, 0);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** Validates the exact shape/keys of a roster config from an untrusted request body. */
export function validateRosterConfig(input: unknown): RosterConfig | null {
  if (typeof input !== "object" || input === null) {
    return null;
  }

  const result = {} as RosterConfig;

  for (const league of Object.keys(ROSTER_POSITIONS) as SportLeague[]) {
    const leagueConfig = (input as Record<string, unknown>)[league];
    if (typeof leagueConfig !== "object" || leagueConfig === null) {
      return null;
    }

    const { positions, bench } = leagueConfig as Record<string, unknown>;
    if (typeof positions !== "object" || positions === null || !isNonNegativeInteger(bench)) {
      return null;
    }

    const expectedKeys = ROSTER_POSITIONS[league];
    const actualKeys = Object.keys(positions);
    if (actualKeys.length !== expectedKeys.length || !expectedKeys.every((k) => k in (positions as object))) {
      return null;
    }

    const validatedPositions: Record<string, number> = {};
    for (const key of expectedKeys) {
      const count = (positions as Record<string, unknown>)[key];
      if (!isNonNegativeInteger(count)) {
        return null;
      }
      validatedPositions[key] = count;
    }

    result[league] = { positions: validatedPositions, bench };
  }

  return result;
}

/**
 * Fills a player's named position slot first (if that league's configured
 * count for it isn't full yet), otherwise falls back to the league's bench.
 * Replays the same greedy bucketing as assignRosterSlots over the team's
 * existing entries first, so bench occupancy reflects who *actually* spilled
 * over to bench rather than just "is the league's roster full overall"
 * (which would wrongly let a 3rd same-position player in ahead of a 2nd
 * different-position player still needing its own slot). Returns true with
 * no rosterConfig at all (legacy drafts predate this field - no enforcement
 * rather than blocking every pick).
 */
export function hasRosterCapacity(
  rosterConfig: RosterConfig | undefined,
  teamEntries: { position: string; sportLeague: SportLeague }[],
  player: Player,
): boolean {
  if (!rosterConfig) {
    return true;
  }

  const leagueConfig = rosterConfig[player.sportLeague];
  const leagueEntries = teamEntries.filter((e) => e.sportLeague === player.sportLeague);

  const filledPositionCounts: Record<string, number> = {};
  let benchFilled = 0;
  for (const entry of leagueEntries) {
    const configuredSlots = leagueConfig.positions[entry.position] ?? 0;
    const filled = filledPositionCounts[entry.position] ?? 0;
    if (filled < configuredSlots) {
      filledPositionCounts[entry.position] = filled + 1;
    } else {
      benchFilled += 1;
    }
  }

  const configuredPositionSlots = leagueConfig.positions[player.position] ?? 0;
  const currentPositionFilled = filledPositionCounts[player.position] ?? 0;
  if (currentPositionFilled < configuredPositionSlots) {
    return true;
  }

  return benchFilled < leagueConfig.bench;
}

/**
 * Walks a team's picks in pick order, greedily bucketing each into its named
 * position slot if there's room, otherwise bench - the same admission order
 * the server uses, so a roster display built from this always matches what
 * hasRosterCapacity would have allowed.
 */
export function assignRosterSlots(
  rosterConfig: RosterConfig,
  teamPicksInOrder: { playerId: string; position: string; sportLeague: SportLeague }[],
): { league: SportLeague; slot: string; playerId: string }[] {
  const assignments: { league: SportLeague; slot: string; playerId: string }[] = [];
  const filledCounts: Record<SportLeague, Record<string, number>> = { NBA: {}, NFL: {} };

  for (const pick of teamPicksInOrder) {
    const leagueConfig = rosterConfig[pick.sportLeague];
    const configuredSlots = leagueConfig.positions[pick.position] ?? 0;
    const filled = filledCounts[pick.sportLeague][pick.position] ?? 0;

    const slot = filled < configuredSlots ? pick.position : "Bench";
    filledCounts[pick.sportLeague][pick.position] = filled + 1;
    assignments.push({ league: pick.sportLeague, slot, playerId: pick.playerId });
  }

  return assignments;
}
