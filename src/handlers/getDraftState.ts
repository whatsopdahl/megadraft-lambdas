import { APIGatewayProxyWebsocketHandlerV2 } from "aws-lambda";
import { attachDraftToConnection, getConnection } from "../lib/connection.js";
import { sendToConnection } from "../lib/broadcast.js";
import { getDraft, getPicksForDraft } from "../lib/draftRepo.js";
import type { InboundMessage } from "../lib/types.js";

export const handler: APIGatewayProxyWebsocketHandlerV2 = async (event) => {
  try {
    const connectionId = event.requestContext.connectionId;
    const body = JSON.parse(event.body ?? "{}") as InboundMessage;

    if (body.action !== "getDraftState") {
      return { statusCode: 200, body: "" };
    }

    const connection = await getConnection(connectionId);
    if (!connection) {
      await sendToConnection(connectionId, { type: "error", message: "Not connected" });
      return { statusCode: 200, body: "" };
    }

    const draft = await getDraft(body.draftId);
    if (!draft) {
      await sendToConnection(connectionId, { type: "error", message: "Draft not found" });
      return { statusCode: 200, body: "" };
    }

    await attachDraftToConnection(connectionId, body.draftId);

    const picks = await getPicksForDraft(body.draftId);

    await sendToConnection(connectionId, { type: "draftState", draft, picks });

    return { statusCode: 200, body: "" };
  } catch (error) {
    console.error("Get draft state error:", error);
    return { statusCode: 200, body: "" };
  }
};
