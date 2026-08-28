import { APIGatewayProxyWebsocketHandlerV2 } from "aws-lambda";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddb } from "../lib/dynamo.js";
import { env } from "../lib/env.js";
import { getConnection } from "../lib/connection.js";
import { sendToConnection, broadcastToDraft } from "../lib/broadcast.js";
import { getDraft } from "../lib/draftRepo.js";
import { schedulePickTimeout } from "../lib/scheduler.js";
import { triggerImmediateAutoPickIfEnabled } from "../lib/autoPick.js";
import type { InboundMessage } from "../lib/types.js";

export const handler: APIGatewayProxyWebsocketHandlerV2 = async (event) => {
  try {
    const connectionId = event.requestContext.connectionId;
    const body = JSON.parse(event.body ?? "{}") as InboundMessage;

    if (body.action !== "resumeDraft") {
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
      await sendToConnection(connectionId, { type: "error", message: "Only the commissioner can resume the draft" });
      return { statusCode: 200, body: "" };
    }

    if (draft.status !== "paused") {
      await sendToConnection(connectionId, { type: "error", message: "Draft is not paused" });
      return { statusCode: 200, body: "" };
    }

    const deadline = new Date(Date.now() + (draft.pausedRemainingMs ?? draft.pickTimerSeconds * 1000));

    try {
      await ddb.send(
        new UpdateCommand({
          TableName: env.draftsTable,
          Key: { draftId: body.draftId },
          UpdateExpression: "SET #status = :active, currentPickDeadline = :deadline REMOVE pausedRemainingMs",
          ConditionExpression: "#status = :paused",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: {
            ":active": "active",
            ":paused": "paused",
            ":deadline": deadline.toISOString(),
          },
        }),
      );
    } catch (error) {
      if ((error as { name?: string }).name === "ConditionalCheckFailedException") {
        await sendToConnection(connectionId, { type: "error", message: "Draft is not paused" });
        return { statusCode: 200, body: "" };
      }
      throw error;
    }

    await Promise.all([
      schedulePickTimeout(body.draftId, draft.currentPickNumber, deadline),
      triggerImmediateAutoPickIfEnabled(draft, draft.currentPickNumber),
    ]);

    const updatedDraft = await getDraft(body.draftId);
    if (updatedDraft) {
      await broadcastToDraft(body.draftId, { type: "draftResumed", draft: updatedDraft });
    }

    return { statusCode: 200, body: "" };
  } catch (error) {
    console.error("Resume draft error:", error);
    return { statusCode: 200, body: "" };
  }
};
