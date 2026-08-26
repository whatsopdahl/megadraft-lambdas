import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { ddb } from "../lib/dynamo.js";
import { env } from "../lib/env.js";
import { requireAuth, jsonResponse } from "../lib/http.js";
import { getDraft } from "../lib/draftRepo.js";
import { deleteRosterTable } from "../lib/rosterRepo.js";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  let user;
  try {
    user = await requireAuth(event);
  } catch (error) {
    console.error("Delete draft auth error:", error);
    return jsonResponse(401, { message: "Unauthorized" });
  }

  try {
    const draftId = event.pathParameters?.draftId;
    if (!draftId) {
      return jsonResponse(400, { message: "Missing draftId" });
    }

    const draft = await getDraft(draftId);
    if (!draft) {
      return jsonResponse(404, { message: "Draft not found" });
    }

    if (draft.commissionerUserId !== user.userId) {
      return jsonResponse(403, { message: "Only the commissioner can delete the draft" });
    }

    await deleteRosterTable(draftId);

    await ddb.send(
      new DeleteCommand({
        TableName: env.draftsTable,
        Key: { draftId },
      }),
    );

    return jsonResponse(200, { message: "Draft deleted" });
  } catch (error) {
    console.error("Delete draft error:", error);
    return jsonResponse(500, { message: "Failed to delete draft" });
  }
};
