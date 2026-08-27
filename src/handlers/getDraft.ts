import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { requireAuth, jsonResponse } from "../lib/http.js";
import { getDraft } from "../lib/draftRepo.js";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    await requireAuth(event);
  } catch (error) {
    console.error("Get draft auth error:", error);
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

    return jsonResponse(200, { draft });
  } catch (error) {
    console.error("Get draft error:", error);
    return jsonResponse(500, { message: "Failed to fetch draft" });
  }
};
