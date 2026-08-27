import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { requireAuth, jsonResponse, sanitizeDraft } from "../lib/http.js";
import { getDraftsByName } from "../lib/draftRepo.js";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    await requireAuth(event);
  } catch (error) {
    console.error("Search drafts auth error:", error);
    return jsonResponse(401, { message: "Unauthorized" });
  }

  try {
    const draftName = event.queryStringParameters?.draftName;
    if (!draftName) {
      return jsonResponse(400, { message: "Missing draftName" });
    }

    const drafts = await getDraftsByName(draftName);
    return jsonResponse(200, { drafts: drafts.map(sanitizeDraft) });
  } catch (error) {
    console.error("Search drafts error:", error);
    return jsonResponse(500, { message: "Failed to search drafts" });
  }
};
