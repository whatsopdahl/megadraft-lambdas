import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import { ddb } from "../lib/dynamo.js";
import { env } from "../lib/env.js";
import {
  fetchCurrentScoringPeriod,
  fetchFreeAgents,
  FOOTBALL_SLOT_IDS,
  toBasketballPlayerFields,
  toFootballPlayerFields,
  type EspnCookies,
} from "../lib/espn.js";
import { getOverallRanking } from "../lib/overallRankings.js";
import type { Player } from "../lib/types.js";

// Manually invoked (`aws lambda invoke`) - see README for the Secrets
// Manager setup this reads from and how to run it.
interface EspnSecret {
  espnS2: string;
  swid: string;
  nfl: { leagueId: string; year: number };
  nba: { leagueId: string; year: number };
}

const NFL_POSITION_GROUPS: { slotId: number; size: number }[] = [
  { slotId: FOOTBALL_SLOT_IDS.QB, size: 100 },
  { slotId: FOOTBALL_SLOT_IDS.RB, size: 100 },
  { slotId: FOOTBALL_SLOT_IDS.WR, size: 200 },
  { slotId: FOOTBALL_SLOT_IDS.TE, size: 100 },
  { slotId: FOOTBALL_SLOT_IDS.K, size: 50 },
  { slotId: FOOTBALL_SLOT_IDS["D/ST"], size: 50 },
];

// Generously above the ~550 active NBA roster spots.
const NBA_ALL_PLAYERS_SIZE = 1000;

const secretsClient = new SecretsManagerClient({});

async function loadEspnSecret(): Promise<EspnSecret> {
  const result = await secretsClient.send(new GetSecretValueCommand({ SecretId: env.espnCredentialsSecretArn }));
  if (!result.SecretString) {
    throw new Error("ESPN credentials secret has no SecretString");
  }
  return JSON.parse(result.SecretString) as EspnSecret;
}

async function fetchNflPlayers(secret: EspnSecret, cookies: EspnCookies, maxPlayersPerLeague?: number): Promise<Player[]> {
  const { leagueId, year } = secret.nfl;
  const week = await fetchCurrentScoringPeriod("nfl", leagueId, year, cookies);

  const players: Player[] = [];
  for (const group of NFL_POSITION_GROUPS) {
    const size = maxPlayersPerLeague === undefined ? group.size : Math.min(group.size, maxPlayersPerLeague);
    const rawPlayers = await fetchFreeAgents("nfl", leagueId, year, week, size, group.slotId, cookies);
    players.push(
      ...rawPlayers.map((raw) => {
        const fields = toFootballPlayerFields(raw);
        return { sportLeague: "NFL" as const, ...fields, overallRanking: getOverallRanking("NFL", fields.name) };
      }),
    );
  }
  return players;
}

async function fetchNbaPlayers(secret: EspnSecret, cookies: EspnCookies, maxPlayersPerLeague?: number): Promise<Player[]> {
  const { leagueId, year } = secret.nba;
  const week = await fetchCurrentScoringPeriod("nba", leagueId, year, cookies);

  const size = maxPlayersPerLeague === undefined ? NBA_ALL_PLAYERS_SIZE : Math.min(NBA_ALL_PLAYERS_SIZE, maxPlayersPerLeague);
  const rawPlayers = await fetchFreeAgents("nba", leagueId, year, week, size, undefined, cookies);
  return rawPlayers.map((raw) => {
    const fields = toBasketballPlayerFields(raw);
    return { sportLeague: "NBA" as const, ...fields, overallRanking: getOverallRanking("NBA", fields.name) };
  });
}

async function batchWritePlayers(players: Player[]): Promise<void> {
  const chunkSize = 25;
  for (let i = 0; i < players.length; i += chunkSize) {
    const chunk = players.slice(i, i + chunkSize);
    await ddb.send(
      new BatchWriteCommand({
        RequestItems: {
          [env.playersTable]: chunk.map((item) => ({ PutRequest: { Item: item } })),
        },
      }),
    );
  }
}

interface SyncEspnPlayersEvent {
  /** Caps players fetched per position group (NFL) / per league (NBA) - for cheap test invokes, not for production use. */
  maxPlayersPerLeague?: number;
}

export const handler = async (event?: SyncEspnPlayersEvent): Promise<{ nfl: number; nba: number }> => {
  const secret = await loadEspnSecret();
  const cookies: EspnCookies = { espnS2: secret.espnS2, swid: secret.swid };
  const { maxPlayersPerLeague } = event ?? {};

  const [nflPlayers, nbaPlayers] = await Promise.all([
    fetchNflPlayers(secret, cookies, maxPlayersPerLeague),
    fetchNbaPlayers(secret, cookies, maxPlayersPerLeague),
  ]);

  await batchWritePlayers(nflPlayers);
  await batchWritePlayers(nbaPlayers);

  console.log(`Synced ${nflPlayers.length} NFL players and ${nbaPlayers.length} NBA players into ${env.playersTable}`);

  return { nfl: nflPlayers.length, nba: nbaPlayers.length };
};
