import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { Player, SportLeague } from "../src/lib/types.js";
import { ddb } from "../src/lib/dynamo.js";
import { env } from "../src/lib/env.js";

interface PlayerInput {
  playerId?: string;
  name: string;
  realTeam: string;
  position: string;
  positions?: string[];
  ranking?: number;
  overallRanking?: number;
  injuryStatus?: string;
  estimatedReturnDate?: string;
}

async function main(): Promise<void> {
  // Parse CLI arguments
  const args = process.argv.slice(2);
  let league: SportLeague | undefined;
  let file: string | undefined;
  let table: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--league") {
      league = args[++i] as SportLeague;
    } else if (args[i] === "--file") {
      file = args[++i];
    } else if (args[i] === "--table") {
      table = args[++i];
    }
  }

  // Validate required arguments
  if (!league || !file) {
    console.error("Usage: seed-players --league <league> --file <file> [--table <table>]");
    console.error("League must be one of: NBA, NFL, MLB");
    process.exit(1);
  }

  // Validate league
  if (!["NBA", "NFL", "MLB"].includes(league)) {
    console.error(`Invalid league: ${league}. Must be one of: NBA, NFL, MLB`);
    process.exit(1);
  }

  // Read and parse JSON file
  let playerInputs: PlayerInput[];
  try {
    const fileContent = readFileSync(file, "utf-8");
    playerInputs = JSON.parse(fileContent);
    if (!Array.isArray(playerInputs)) {
      throw new Error("File must contain a JSON array");
    }
  } catch (err) {
    console.error(`Failed to read or parse file: ${file}`);
    console.error(err);
    process.exit(1);
  }

  // Determine target table
  const tableName = table || env.playersTable;

  // Build Player items with generated UUIDs
  const players: Player[] = playerInputs.map((input) => ({
    sportLeague: league,
    playerId: input.playerId || randomUUID(),
    name: input.name,
    realTeam: input.realTeam,
    position: input.position,
    positions: input.positions ?? [input.position],
    ranking: input.ranking ?? 0,
    overallRanking: input.overallRanking ?? 0,
    injuryStatus: input.injuryStatus ?? "ACTIVE",
    estimatedReturnDate: input.estimatedReturnDate,
  }));

  // Batch write in chunks of 25
  const chunkSize = 25;
  for (let i = 0; i < players.length; i += chunkSize) {
    const chunk = players.slice(i, i + chunkSize);
    const command = new BatchWriteCommand({
      RequestItems: {
        [tableName]: chunk.map((item) => ({
          PutRequest: {
            Item: item,
          },
        })),
      },
    });
    await ddb.send(command);
  }

  console.log(`Seeded ${players.length} ${league} players into ${tableName}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
