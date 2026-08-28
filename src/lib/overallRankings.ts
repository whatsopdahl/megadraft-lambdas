import type { SportLeague } from "./types.js";
import nbaOverallRankings from "../data/nbaOverallRankings.json";
import nflOverallRankings from "../data/nflOverallRankings.json";

const RANKINGS_BY_LEAGUE: Record<SportLeague, Record<string, number>> = {
  NBA: nbaOverallRankings,
  NFL: nflOverallRankings,
};

// name-matched against the RK/PLAYER NAME CSVs in data/ (see
// scripts/generate-overall-rankings.ts) rather than ESPN's own totalRanking.
export function getOverallRanking(sportLeague: SportLeague, name: string): number {
  return RANKINGS_BY_LEAGUE[sportLeague][name.trim().toLowerCase()] ?? 0;
}
