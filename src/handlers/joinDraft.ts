import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddb } from "../lib/dynamo.js";
import { env } from "../lib/env.js";
import { requireAuth, jsonResponse, sanitizeDraft } from "../lib/http.js";
import { broadcastToDraft } from "../lib/broadcast.js";
import { getDraft } from "../lib/draftRepo.js";
import { verifyPassword } from "../lib/password.js";

interface JoinDraftBody {
  draftPassword: string;
  fantasyTeamId: string;
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  let user;
  try {
    user = await requireAuth(event);
  } catch (error) {
    console.error("Join draft auth error:", error);
    return jsonResponse(401, { message: "Unauthorized" });
  }

  try {
    const draftId = event.pathParameters?.draftId;
    if (!draftId) {
      return jsonResponse(400, { message: "Missing draftId" });
    }

    const body = JSON.parse(event.body ?? "{}") as Partial<JoinDraftBody>;
    if (!body.draftPassword || !body.fantasyTeamId) {
      return jsonResponse(400, { message: "Missing required fields" });
    }

    const draft = await getDraft(draftId);
    if (!draft) {
      return jsonResponse(404, { message: "Draft not found" });
    }

    const isPasswordValid = await verifyPassword(body.draftPassword, draft.draftPasswordHash);
    if (!isPasswordValid) {
      return jsonResponse(403, { message: "Incorrect password" });
    }

    const index = draft.teams.findIndex((t) => t.fantasyTeamId === body.fantasyTeamId);
    if (index === -1) {
      return jsonResponse(404, { message: "Team not found" });
    }

    if (draft.teams[index].ownerUserId && draft.teams[index].ownerUserId !== user.userId) {
      return jsonResponse(409, { message: "That team is already claimed" });
    }

    try {
      await ddb.send(
        new UpdateCommand({
          TableName: env.draftsTable,
          Key: { draftId },
          UpdateExpression: `SET teams[${index}].ownerUserId = :uid`,
          ConditionExpression: `attribute_not_exists(teams[${index}].ownerUserId) OR teams[${index}].ownerUserId = :uid`,
          ExpressionAttributeValues: { ":uid": user.userId },
        }),
      );
    } catch (error) {
      if ((error as { name?: string }).name === "ConditionalCheckFailedException") {
        return jsonResponse(409, { message: "That team is already claimed" });
      }
      throw error;
    }

    draft.teams[index].ownerUserId = user.userId;

    await broadcastToDraft(draftId, { type: "draftUpdated", draft });

    return jsonResponse(200, { draft: sanitizeDraft(draft) });
  } catch (error) {
    console.error("Join draft error:", error);
    return jsonResponse(500, { message: "Failed to join draft" });
  }
};
