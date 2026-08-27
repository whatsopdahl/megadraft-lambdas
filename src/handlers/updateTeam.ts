import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddb } from "../lib/dynamo.js";
import { env } from "../lib/env.js";
import { requireAuth, jsonResponse } from "../lib/http.js";
import { broadcastToDraft } from "../lib/broadcast.js";
import { getDraft } from "../lib/draftRepo.js";

interface UpdateTeamBody {
  name?: string;
  color?: string;
  autodraft?: boolean;
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  let user;
  try {
    user = await requireAuth(event);
  } catch (error) {
    console.error("Update team auth error:", error);
    return jsonResponse(401, { message: "Unauthorized" });
  }

  try {
    const draftId = event.pathParameters?.draftId;
    if (!draftId) {
      return jsonResponse(400, { message: "Missing draftId" });
    }

    const body = JSON.parse(event.body ?? "{}") as UpdateTeamBody;

    const draft = await getDraft(draftId);
    if (!draft) {
      return jsonResponse(404, { message: "Draft not found" });
    }

    const index = draft.teams.findIndex((t) => t.ownerUserId === user.userId);
    if (index === -1) {
      return jsonResponse(403, { message: "You don't own a team in this draft" });
    }

    if (body.name !== undefined) {
      draft.teams[index].name = body.name;
    }
    if (body.color !== undefined) {
      draft.teams[index].color = body.color;
    }
    if (body.autodraft !== undefined) {
      draft.teams[index].autodraft = body.autodraft;
    }

    await ddb.send(
      new PutCommand({
        TableName: env.draftsTable,
        Item: draft,
      }),
    );

    await broadcastToDraft(draftId, { type: "draftUpdated", draft });

    return jsonResponse(200, { draft });
  } catch (error) {
    console.error("Update team error:", error);
    return jsonResponse(500, { message: "Failed to update team" });
  }
};
