// Thin client for ESPN's undocumented fantasy sports API - there's no
// official SDK. Endpoint shapes, filter payloads, and position/pro-team ID
// maps below are reverse-engineered from the `espn_api` Python package
// (https://github.com/cwendt94/espn-api), reimplemented here so this repo
// stays single-language (Node/esbuild) rather than adding a Python Lambda
// with its own pip-layer build pipeline.

export type EspnSport = "nfl" | "nba";

export interface EspnCookies {
  espnS2: string;
  swid: string;
}

interface RawEspnPlayerDetail {
  id: number;
  fullName: string;
  proTeamId: number;
  defaultPositionId?: number;
  eligibleSlots?: number[];
  injuryStatus?: string;
  expectedReturnDate?: number[];
}

/** One item of the free-agents response's "players" array. */
interface RawEspnEntry {
  player?: RawEspnPlayerDetail;
  playerPoolEntry?: { player: RawEspnPlayerDetail };
  // Keyed by scoring-period id ("0" is the season-total entry ESPN uses for
  // free-agent listings) - positionalRanking/totalRanking live here, NOT on
  // "player". totalRanking is the overall (position-agnostic) rank.
  ratings?: Record<string, { positionalRanking?: number; totalRanking?: number }>;
}

export interface EspnPlayerFields {
  playerId: string;
  name: string;
  realTeam: string;
  position: string;
  positions: string[];
  ranking: number;
  overallRanking: number;
  injuryStatus: string;
  estimatedReturnDate?: string;
}

const FANTASY_BASE_ENDPOINT = "https://lm-api-reads.fantasy.espn.com/apis/v3/games";
const FANTASY_SPORTS: Record<EspnSport, string> = { nfl: "ffl", nba: "fba" };

// Lineup slot IDs, as used in both `eligibleSlots` and the free-agent
// `filterSlotIds` query filter (NOT the same numbering as `defaultPositionId`
// for football - see FOOTBALL_POSITION_MAP below).
const FOOTBALL_POSITION_MAP: Record<number, string> = {
  0: "QB",
  1: "TQB",
  2: "RB",
  3: "RB/WR",
  4: "WR",
  5: "WR/TE",
  6: "TE",
  7: "OP",
  8: "DT",
  9: "DE",
  10: "LB",
  11: "DL",
  12: "CB",
  13: "S",
  14: "DB",
  15: "DP",
  16: "D/ST",
  17: "K",
  18: "P",
  19: "HC",
  20: "BE",
  21: "IR",
  22: "",
  23: "RB/WR/TE",
  24: "ER",
  25: "Rookie",
};

const BASKETBALL_POSITION_MAP: Record<number, string> = {
  0: "PG",
  1: "SG",
  2: "SF",
  3: "PF",
  4: "C",
  5: "G",
  6: "F",
  7: "SG/SF",
  8: "G/F",
  9: "PF/C",
  10: "F/C",
  11: "UT",
  12: "BE",
  13: "IR",
  14: "",
  15: "Rookie",
};

const FOOTBALL_PRO_TEAM_MAP: Record<number, string> = {
  0: "FA",
  1: "ATL",
  2: "BUF",
  3: "CHI",
  4: "CIN",
  5: "CLE",
  6: "DAL",
  7: "DEN",
  8: "DET",
  9: "GB",
  10: "TEN",
  11: "IND",
  12: "KC",
  13: "LV",
  14: "LAR",
  15: "MIA",
  16: "MIN",
  17: "NE",
  18: "NO",
  19: "NYG",
  20: "NYJ",
  21: "PHI",
  22: "ARI",
  23: "PIT",
  24: "LAC",
  25: "SF",
  26: "SEA",
  27: "TB",
  28: "WSH",
  29: "CAR",
  30: "JAX",
  33: "BAL",
  34: "HOU",
};

const BASKETBALL_PRO_TEAM_MAP: Record<number, string> = {
  0: "FA",
  1: "ATL",
  2: "BOS",
  3: "NOP",
  4: "CHI",
  5: "CLE",
  6: "DAL",
  7: "DEN",
  8: "DET",
  9: "GSW",
  10: "HOU",
  11: "IND",
  12: "LAC",
  13: "LAL",
  14: "MIA",
  15: "MIL",
  16: "MIN",
  17: "BKN",
  18: "NYK",
  19: "ORL",
  20: "PHL",
  21: "PHO",
  22: "POR",
  23: "SAC",
  24: "SAS",
  25: "OKC",
  26: "UTA",
  27: "WAS",
  28: "TOR",
  29: "MEM",
  30: "CHA",
};

// Lineup slot labels that are real positions rather than bench/IR/flex/combo
// eligibility slots - used to build the `positions` list on each player.
const FOOTBALL_REAL_POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "D/ST", "DT", "DE", "LB", "DL", "CB", "S", "DB", "DP"]);
const BASKETBALL_REAL_POSITIONS = new Set(["PG", "SG", "SF", "PF", "C"]);

// Football lineup slot IDs for the position groups the sync job pulls -
// distinct from `defaultPositionId`, which uses a different numbering.
export const FOOTBALL_SLOT_IDS: Record<"QB" | "RB" | "WR" | "TE" | "K" | "D/ST", number> = {
  QB: 0,
  RB: 2,
  WR: 4,
  TE: 6,
  "D/ST": 16,
  K: 17,
};

function leagueEndpoint(sport: EspnSport, year: number, leagueId: string): string {
  return `${FANTASY_BASE_ENDPOINT}/${FANTASY_SPORTS[sport]}/seasons/${year}/segments/0/leagues/${leagueId}`;
}

function cookieHeader(cookies?: EspnCookies): Record<string, string> {
  return cookies ? { Cookie: `espn_s2=${cookies.espnS2}; SWID=${cookies.swid}` } : {};
}

async function espnGet(url: string, headers: Record<string, string>): Promise<any> {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`ESPN API request failed: ${res.status} ${res.statusText} (${url})`);
  }
  return res.json();
}

/**
 * The free-agents endpoint requires the current scoring period (week for
 * NFL, day for NBA). Mirrors `espn_api`'s `League._fetch_league()`, which
 * reads it off the general league-info response.
 */
export async function fetchCurrentScoringPeriod(sport: EspnSport, leagueId: string, year: number, cookies?: EspnCookies): Promise<number> {
  const params = new URLSearchParams();
  for (const view of ["mTeam", "mRoster", "mMatchup", "mSettings", "mStandings"]) {
    params.append("view", view);
  }
  const data = await espnGet(`${leagueEndpoint(sport, year, leagueId)}?${params.toString()}`, cookieHeader(cookies));
  return data.scoringPeriodId ?? data.status?.currentMatchupPeriod ?? 1;
}

/**
 * Fetches free agents for a league, sorted by ESPN's own percent-owned then
 * draft-rank ordering (same as `League.free_agents()` in `espn_api`).
 * `slotId` narrows to a lineup slot (e.g. QB); omit it to fetch all
 * positions, which is how the NBA "all active players" pull works.
 */
export async function fetchFreeAgents(
  sport: EspnSport,
  leagueId: string,
  year: number,
  week: number,
  size: number,
  slotId?: number,
  cookies?: EspnCookies,
): Promise<RawEspnEntry[]> {
  const params = new URLSearchParams({ view: "kona_player_info", scoringPeriodId: String(week) });
  const filter = {
    players: {
      filterStatus: { value: ["FREEAGENT", "WAIVERS"] },
      filterSlotIds: { value: slotId === undefined ? [] : [slotId] },
      limit: size,
      sortPercOwned: { sortPriority: 1, sortAsc: false },
      sortDraftRanks: { sortPriority: 100, sortAsc: true, value: "STANDARD" },
    },
  };

  const data = await espnGet(`${leagueEndpoint(sport, year, leagueId)}?${params.toString()}`, {
    ...cookieHeader(cookies),
    "x-fantasy-filter": JSON.stringify(filter),
  });

  // Deliberately NOT unwrapping to entry.player here: positionalRanking
  // lives on entry.ratings (a sibling of "player", not inside it), so
  // to*PlayerFields below need the whole entry.
  return data.players ?? [];
}

function extractPlayer(entry: RawEspnEntry): RawEspnPlayerDetail {
  return entry.player ?? entry.playerPoolEntry?.player ?? (entry as unknown as RawEspnPlayerDetail);
}

function extractRating(entry: RawEspnEntry): { positionalRanking?: number; totalRanking?: number } {
  const ratings = entry.ratings ?? {};
  return ratings["0"] ?? ratings[Object.keys(ratings)[0]] ?? {};
}

function realPositions(eligibleSlots: number[] | undefined, posMap: Record<number, string>, real: Set<string>): string[] {
  const seen = new Set<string>();
  for (const slot of eligibleSlots ?? []) {
    const label = posMap[slot];
    if (label && real.has(label)) {
      seen.add(label);
    }
  }
  return [...seen];
}

function toIsoDate(parts: number[] | undefined): string | undefined {
  if (!parts || parts.length < 3) {
    return undefined;
  }
  const [year, month, day] = parts;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function toFootballPlayerFields(entry: RawEspnEntry): EspnPlayerFields {
  const player = extractPlayer(entry);
  const rating = extractRating(entry);
  const positions = realPositions(player.eligibleSlots, FOOTBALL_POSITION_MAP, FOOTBALL_REAL_POSITIONS);
  return {
    playerId: String(player.id),
    name: player.fullName,
    realTeam: FOOTBALL_PRO_TEAM_MAP[player.proTeamId] ?? "FA",
    position: positions[0] ?? "",
    positions,
    ranking: rating.positionalRanking ?? 0,
    overallRanking: rating.totalRanking ?? 0,
    injuryStatus: player.injuryStatus ?? "ACTIVE",
    estimatedReturnDate: toIsoDate(player.expectedReturnDate),
  };
}

export function toBasketballPlayerFields(entry: RawEspnEntry): EspnPlayerFields {
  const player = extractPlayer(entry);
  const rating = extractRating(entry);
  const positions = realPositions(player.eligibleSlots, BASKETBALL_POSITION_MAP, BASKETBALL_REAL_POSITIONS);
  // Basketball's raw defaultPositionId is 1-indexed against this same map
  // (1 => PG), unlike eligibleSlots/lineupSlotId which are 0-indexed.
  const primary = player.defaultPositionId !== undefined ? BASKETBALL_POSITION_MAP[player.defaultPositionId - 1] : undefined;
  return {
    playerId: String(player.id),
    name: player.fullName,
    realTeam: BASKETBALL_PRO_TEAM_MAP[player.proTeamId] ?? "FA",
    position: primary ?? positions[0] ?? "",
    positions,
    ranking: rating.positionalRanking ?? 0,
    overallRanking: rating.totalRanking ?? 0,
    injuryStatus: player.injuryStatus ?? "ACTIVE",
    estimatedReturnDate: toIsoDate(player.expectedReturnDate),
  };
}
