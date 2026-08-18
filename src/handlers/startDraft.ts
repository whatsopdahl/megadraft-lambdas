import { APIGatewayProxyWebsocketHandlerV2 } from "aws-lambda";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddb } from "../lib/dynamo.js";
import { env } from "../lib/env.js";
import { getConnection } from "../lib/connection.js";
import { sendToConnection, broadcastToDraft } from "../lib/broadcast.js";
import { getDraft } from "../lib/draftRepo.js";
import { getPlayersForLeague } from "../lib/players.js";
import { schedulePickTimeout } from "../lib/scheduler.js";
import type { InboundMessage } from "../lib/types.js";

function fisherYatesShuffle(array: string[]): void {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

export const handler: APIGatewayProxyWebsocketHandlerV2 = async (event) => {
  try {
    const connectionId = event.requestContext.connectionId;
    const body = JSON.parse(event.body ?? "{}") as InboundMessage;

    if (body.action !== "startDraft") {
      return { statusCode: 200, body: "" };
    }

    const connection = await getConnection(connectionId);
    if (!connection) {
      await sendToConnection(connectionId, { type: "error", message: "Not connected" });
      return { statusCode: 200, body: "" };
    }

    const userId = connection.userId;

    const draft = await getDraft(body.draftId);
    if (!draft) {
      await sendToConnection(connectionId, { type: "error", message: "Draft not found" });
      return { statusCode: 200, body: "" };
    }

    if (draft.commissionerUserId !== userId) {
      await sendToConnection(connectionId, { type: "error", message: "Only the commissioner can start the draft" });
      return { statusCode: 200, body: "" };
    }

    if (draft.status !== "pending") {
      await sendToConnection(connectionId, { type: "error", message: "Draft already started" });
      return { statusCode: 200, body: "" };
    }

    fisherYatesShuffle(draft.pickOrderTeamIds);

    const deadline = new Date(Date.now() + draft.pickTimerSeconds * 1000);

    draft.status = "active";
    draft.currentPickNumber = 1;
    draft.currentPickDeadline = deadline.toISOString();

    try {
      await ddb.send(
        new PutCommand({
          TableName: env.draftsTable,
          Item: draft,
          ConditionExpression: "#status = :pending",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: { ":pending": "pending" },
        }),
      );
    } catch (error) {
      if ((error as { name?: string }).name === "ConditionalCheckFailedException") {
        await sendToConnection(connectionId, { type: "error", message: "Draft already started" });
        return { statusCode: 200, body: "" };
      }
      throw error;
    }

    await schedulePickTimeout(body.draftId, 1, deadline);

    const players = await getPlayersForLeague(draft.sportLeague);

    await broadcastToDraft(body.draftId, { type: "draftStarted", draft });
    await broadcastToDraft(body.draftId, { type: "draftState", draft, picks: [], players });

    return { statusCode: 200, body: "" };
  } catch (error) {
    console.error("Start draft error:", error);
    return { statusCode: 200, body: "" };
  }
};
