import { ApiGatewayManagementApiClient, PostToConnectionCommand } from "@aws-sdk/client-apigatewaymanagementapi";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddb } from "./dynamo.js";
import { env } from "./env.js";
import type { ConnectionRecord, OutboundMessage } from "./types.js";

const apiClient = new ApiGatewayManagementApiClient({
  endpoint: env.webSocketManagementEndpoint,
});

async function connectionsForDraft(draftId: string): Promise<ConnectionRecord[]> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: env.connectionsTable,
      IndexName: "byDraftId",
      KeyConditionExpression: "draftId = :draftId",
      ExpressionAttributeValues: { ":draftId": draftId },
    }),
  );

  return (result.Items ?? []) as ConnectionRecord[];
}

/** Pushes a message to every connected socket for a draft, dropping stale connections. */
export async function broadcastToDraft(draftId: string, message: OutboundMessage): Promise<void> {
  const connections = await connectionsForDraft(draftId);
  const data = Buffer.from(JSON.stringify(message));

  await Promise.all(
    connections.map(async (connection) => {
      try {
        await apiClient.send(
          new PostToConnectionCommand({
            ConnectionId: connection.connectionId,
            Data: data,
          }),
        );
      } catch (error) {
        // GoneException means the client disconnected without us catching a
        // $disconnect event yet - safe to ignore, TTL will clean it up.
        if ((error as { name?: string }).name !== "GoneException") {
          throw error;
        }
      }
    }),
  );
}

/** Sends a message to a single connection (e.g. an error reply to the sender). */
export async function sendToConnection(connectionId: string, message: OutboundMessage): Promise<void> {
  await apiClient.send(
    new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: Buffer.from(JSON.stringify(message)),
    }),
  );
}
