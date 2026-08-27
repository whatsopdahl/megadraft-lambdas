import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { ddb } from "../lib/dynamo.js";
import { env } from "../lib/env.js";
import { requireAuth, jsonResponse } from "../lib/http.js";
import { putDraft } from "../lib/draftRepo.js";
import { claimTeamsByEmail } from "../lib/teamClaims.js";
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

    // This is also where email-based auto-claiming happens: a team invited by
    // email gets claimed for this user the first time they load their
    // dashboard after logging in, no separate join step.
    const myDrafts: Draft[] = [];
    for (const draft of drafts) {
      const { teams, changed } = claimTeamsByEmail(draft.teams, user);
      if (changed) {
        draft.teams = teams;
        await putDraft(draft);
      }

      if (draft.commissionerUserId === user.userId || draft.teams.some((t) => t.ownerUserId === user.userId)) {
        myDrafts.push(draft);
      }
    }

    return jsonResponse(200, { drafts: myDrafts });
  } catch (error) {
    console.error("List my drafts error:", error);
    return jsonResponse(500, { message: "Failed to list drafts" });
  }
};
