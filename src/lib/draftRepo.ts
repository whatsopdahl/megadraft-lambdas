import { GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddb } from "./dynamo.js";
import { env } from "./env.js";
import type { Draft, DraftPick } from "./types.js";

export async function getDraft(draftId: string): Promise<Draft | undefined> {
  const result = await ddb.send(
    new GetCommand({
      TableName: env.draftsTable,
      Key: { draftId },
    }),
  );

  return result.Item as Draft | undefined;
}

export async function putDraft(draft: Draft): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: env.draftsTable,
      Item: draft,
    }),
  );
}

export async function getPicksForDraft(draftId: string): Promise<DraftPick[]> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: env.draftPicksTable,
      KeyConditionExpression: "draftId = :d",
      ExpressionAttributeValues: { ":d": draftId },
    }),
  );

  return (result.Items ?? []) as DraftPick[];
}
