import { CreateTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddb } from "./dynamo.js";

const rawClient = new DynamoDBClient({});

export interface RosterEntry {
  fantasyTeamId: string;
  playerId: string;
  pickNumber: number;
  pickedByUserId: string | null;
  pickedAt: string;
}

/** Every draft gets its own roster table, isolated from other drafts. */
export function rosterTableName(draftId: string): string {
  return `megadraft-${draftId}-rosters`;
}

/**
 * Provisions the per-draft roster table at draft-creation time. Not awaited
 * to ACTIVE - CreateTable typically completes in a few seconds, well before
 * a draft is started and a first pick can be made.
 */
export async function createRosterTable(draftId: string): Promise<void> {
  try {
    await rawClient.send(
      new CreateTableCommand({
        TableName: rosterTableName(draftId),
        BillingMode: "PAY_PER_REQUEST",
        KeySchema: [
          { AttributeName: "fantasyTeamId", KeyType: "HASH" },
          { AttributeName: "playerId", KeyType: "RANGE" },
        ],
        AttributeDefinitions: [
          { AttributeName: "fantasyTeamId", AttributeType: "S" },
          { AttributeName: "playerId", AttributeType: "S" },
        ],
      }),
    );
  } catch (error) {
    if ((error as { name?: string }).name !== "ResourceInUseException") {
      throw error;
    }
  }
}

export async function addRosterEntry(draftId: string, entry: RosterEntry): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: rosterTableName(draftId),
      Item: entry,
    }),
  );
}
