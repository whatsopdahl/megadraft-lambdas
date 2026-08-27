import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { requireAuth, jsonResponse } from "../lib/http.js";
import { getPicksForDraft } from "../lib/draftRepo.js";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    await requireAuth(event);
  } catch (error) {
    console.error("Get draft picks auth error:", error);
    return jsonResponse(401, { message: "Unauthorized" });
  }

  try {
    const draftId = event.pathParameters?.draftId;
    if (!draftId) {
      return jsonResponse(400, { message: "Missing draftId" });
    }

    const picks = await getPicksForDraft(draftId);
    return jsonResponse(200, { picks });
  } catch (error) {
    console.error("Get draft picks error:", error);
    return jsonResponse(500, { message: "Failed to fetch draft picks" });
  }
};
