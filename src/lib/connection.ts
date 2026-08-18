import { GetCommand, PutCommand, DeleteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddb } from "./dynamo.js";
import { env } from "./env.js";
import type { ConnectionRecord } from "./types.js";

const CONNECTION_TTL_SECONDS = 24 * 60 * 60;

export async function createConnection(connectionId: string, userId: string): Promise<void> {
  const record: ConnectionRecord = {
    connectionId,
    draftId: "",
    userId,
    connectedAt: new Date().toISOString(),
    expiresAt: Math.floor(Date.now() / 1000) + CONNECTION_TTL_SECONDS,
  };

  await ddb.send(new PutCommand({ TableName: env.connectionsTable, Item: record }));
}

export async function getConnection(connectionId: string): Promise<ConnectionRecord | undefined> {
  const result = await ddb.send(
    new GetCommand({ TableName: env.connectionsTable, Key: { connectionId } }),
  );
  return result.Item as ConnectionRecord | undefined;
}

export async function attachDraftToConnection(connectionId: string, draftId: string): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName: env.connectionsTable,
      Key: { connectionId },
      UpdateExpression: "SET draftId = :draftId",
      ExpressionAttributeValues: { ":draftId": draftId },
    }),
  );
}

export async function removeConnection(connectionId: string): Promise<void> {
  await ddb.send(new DeleteCommand({ TableName: env.connectionsTable, Key: { connectionId } }));
}
