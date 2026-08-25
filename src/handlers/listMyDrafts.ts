import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { ddb } from "../lib/dynamo.js";
import { env } from "../lib/env.js";
import { requireAuth, jsonResponse, sanitizeDraft } from "../lib/http.js";
import type { Draft } from "../lib/types.js";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  let user;
  try {
    user = await requireAuth(event);
  } catch (error) {
    console.error("List my drafts auth error:", error);
    return jsonResponse(401, { message: "Unauthorized" });
  }

  try {
    // Drafts are scanned rather than indexed - membership can come from being
    // the commissioner or owning any one of several teams, and this table is
    // small/low-frequency enough that a GSI isn't worth the write-path upkeep.
    const result = await ddb.send(new ScanCommand({ TableName: env.draftsTable }));
    const drafts = (result.Items ?? []) as Draft[];

    const myDrafts = drafts.filter(
      (draft) =>
        draft.commissionerUserId === user.userId ||
        draft.teams.some((t) => t.ownerUserId === user.userId),
    );

    return jsonResponse(200, { drafts: myDrafts.map(sanitizeDraft) });
  } catch (error) {
    console.error("List my drafts error:", error);
    return jsonResponse(500, { message: "Failed to list drafts" });
  }
};
