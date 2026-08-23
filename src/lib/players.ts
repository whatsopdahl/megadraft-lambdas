import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddb } from "./dynamo.js";
import { env } from "./env.js";
import type { Player, SportLeague } from "./types.js";

export async function getPlayersForLeague(sportLeague: SportLeague): Promise<Player[]> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: env.playersTable,
      KeyConditionExpression: "sportLeague = :s",
      ExpressionAttributeValues: { ":s": sportLeague },
    }),
  );

  return (result.Items ?? []) as Player[];
}

export async function getPlayer(sportLeague: SportLeague, playerId: string): Promise<Player | undefined> {
  const result = await ddb.send(
    new GetCommand({
      TableName: env.playersTable,
      Key: { sportLeague, playerId },
    }),
  );

  return result.Item as Player | undefined;
}

/** Full player pool across every league a draft spans. */
export async function getPlayersForLeagues(sportLeagues: SportLeague[]): Promise<Player[]> {
  const players: Player[] = [];
  for (const league of sportLeagues) {
    players.push(...(await getPlayersForLeague(league)));
  }
  return players;
}

/** Looks a player up across every league a draft spans (the league isn't known up-front). */
export async function getPlayerInLeagues(sportLeagues: SportLeague[], playerId: string): Promise<Player | undefined> {
  for (const league of sportLeagues) {
    const player = await getPlayer(league, playerId);
    if (player) {
      return player;
    }
  }
  return undefined;
}
