import { APIGatewayProxyWebsocketHandlerV2 } from "aws-lambda";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddb } from "../lib/dynamo.js";
import { env } from "../lib/env.js";
import { getConnection, attachDraftToConnection } from "../lib/connection.js";
import { sendToConnection, broadcastToDraft } from "../lib/broadcast.js";
import { getDraft } from "../lib/draftRepo.js";
import { getPicksForDraft } from "../lib/draftRepo.js";
import { getPlayersForLeague } from "../lib/players.js";
import { verifyPassword } from "../lib/password.js";
import type { InboundMessage } from "../lib/types.js";

export const handler: APIGatewayProxyWebsocketHandlerV2 = async (event) => {
  try {
    const connectionId = event.requestContext.connectionId;
    const body = JSON.parse(event.body ?? "{}") as InboundMessage;

    if (body.action !== "joinDraft") {
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

    const isPasswordValid = await verifyPassword(body.draftPassword, draft.draftPasswordHash);
    if (!isPasswordValid) {
      await sendToConnection(connectionId, { type: "error", message: "Incorrect password" });
      return { statusCode: 200, body: "" };
    }

    const index = draft.teams.findIndex((t) => t.fantasyTeamId === body.fantasyTeamId);
    if (index === -1) {
      await sendToConnection(connectionId, { type: "error", message: "Team not found" });
      return { statusCode: 200, body: "" };
    }

    if (draft.teams[index].ownerUserId && draft.teams[index].ownerUserId !== userId) {
      await sendToConnection(connectionId, { type: "error", message: "That team is already claimed" });
      return { statusCode: 200, body: "" };
    }

    try {
      await ddb.send(
        new UpdateCommand({
          TableName: env.draftsTable,
          Key: { draftId: body.draftId },
          UpdateExpression: `SET teams[${index}].ownerUserId = :uid`,
          ConditionExpression: `attribute_not_exists(teams[${index}].ownerUserId) OR teams[${index}].ownerUserId = :uid`,
          ExpressionAttributeValues: { ":uid": userId },
        }),
      );
    } catch (error) {
      if ((error as { name?: string }).name === "ConditionalCheckFailedException") {
        await sendToConnection(connectionId, { type: "error", message: "That team is already claimed" });
        return { statusCode: 200, body: "" };
      }
      throw error;
    }

    await attachDraftToConnection(connectionId, body.draftId);

    draft.teams[index].ownerUserId = userId;

    const picks = await getPicksForDraft(body.draftId);
    const players = await getPlayersForLeague(draft.sportLeague);

    await broadcastToDraft(body.draftId, { type: "draftState", draft, picks, players });

    return { statusCode: 200, body: "" };
  } catch (error) {
    console.error("Join draft error:", error);
    return { statusCode: 200, body: "" };
  }
};
