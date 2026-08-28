import { APIGatewayProxyWebsocketHandlerV2 } from "aws-lambda";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddb } from "../lib/dynamo.js";
import { env } from "../lib/env.js";
import { getConnection } from "../lib/connection.js";
import { sendToConnection, broadcastToDraft } from "../lib/broadcast.js";
import { getDraft } from "../lib/draftRepo.js";
import { cancelPickTimeout } from "../lib/scheduler.js";
import type { InboundMessage } from "../lib/types.js";

export const handler: APIGatewayProxyWebsocketHandlerV2 = async (event) => {
  try {
    const connectionId = event.requestContext.connectionId;
    const body = JSON.parse(event.body ?? "{}") as InboundMessage;

    if (body.action !== "pauseDraft") {
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
      await sendToConnection(connectionId, { type: "error", message: "Only the commissioner can pause the draft" });
      return { statusCode: 200, body: "" };
    }

    if (draft.status !== "active") {
      await sendToConnection(connectionId, { type: "error", message: "Draft is not active" });
      return { statusCode: 200, body: "" };
    }

    const pausedRemainingMs = draft.currentPickDeadline
      ? Math.max(0, new Date(draft.currentPickDeadline).getTime() - Date.now())
      : 0;

    try {
      await ddb.send(
        new UpdateCommand({
          TableName: env.draftsTable,
          Key: { draftId: body.draftId },
          UpdateExpression: "SET #status = :paused, pausedRemainingMs = :remaining, currentPickDeadline = :null",
          ConditionExpression: "#status = :active",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: {
            ":paused": "paused",
            ":active": "active",
            ":remaining": pausedRemainingMs,
            ":null": null,
          },
        }),
      );
    } catch (error) {
      if ((error as { name?: string }).name === "ConditionalCheckFailedException") {
        await sendToConnection(connectionId, { type: "error", message: "Draft is not active" });
        return { statusCode: 200, body: "" };
      }
      throw error;
    }

    await cancelPickTimeout(body.draftId, draft.currentPickNumber);

    const updatedDraft = await getDraft(body.draftId);
    if (updatedDraft) {
      await broadcastToDraft(body.draftId, { type: "draftPaused", draft: updatedDraft });
    }

    return { statusCode: 200, body: "" };
  } catch (error) {
    console.error("Pause draft error:", error);
    return { statusCode: 200, body: "" };
  }
};
