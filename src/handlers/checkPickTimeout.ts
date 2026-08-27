import { APIGatewayProxyWebsocketHandlerV2 } from "aws-lambda";
import { getConnection } from "../lib/connection.js";
import { getDraft } from "../lib/draftRepo.js";
import { cancelPickTimeout } from "../lib/scheduler.js";
import { performAutoPick } from "../lib/autoPick.js";
import type { InboundMessage } from "../lib/types.js";

/**
 * Fast path for autodraft: connected clients call this the instant their
 * local countdown reaches the pick deadline, instead of waiting on
 * EventBridge Scheduler's one-time schedule (which can fire tens of seconds
 * late). The server never trusts the client's timing or claimed pick number -
 * it re-derives both from the persisted draft and only proceeds if its own
 * clock agrees the deadline has actually passed, so a fast/skewed/malicious
 * client can't force an early auto-pick. EventBridge's pickTimeout schedule
 * remains the durable fallback for when nobody is connected.
 */
export const handler: APIGatewayProxyWebsocketHandlerV2 = async (event) => {
  try {
    const connectionId = event.requestContext.connectionId;
    const body = JSON.parse(event.body ?? "{}") as InboundMessage;

    if (body.action !== "checkPickTimeout") {
      return { statusCode: 200, body: "" };
    }

    const connection = await getConnection(connectionId);
    if (!connection) {
      return { statusCode: 200, body: "" };
    }

    const draft = await getDraft(body.draftId);
    if (!draft || draft.status !== "active" || !draft.currentPickDeadline) {
      return { statusCode: 200, body: "" };
    }

    if (Date.now() < new Date(draft.currentPickDeadline).getTime()) {
      return { statusCode: 200, body: "" };
    }

    const pickNumber = draft.currentPickNumber;
    await cancelPickTimeout(body.draftId, pickNumber);
    await performAutoPick(body.draftId, pickNumber);

    return { statusCode: 200, body: "" };
  } catch (error) {
    console.error("Check pick timeout error:", error);
    return { statusCode: 200, body: "" };
  }
};
