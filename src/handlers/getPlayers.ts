import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { requireAuth, jsonResponse } from "../lib/http.js";
import { getDraft } from "../lib/draftRepo.js";
import { getPlayersForLeagues } from "../lib/players.js";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    await requireAuth(event);
  } catch (error) {
    console.error("Get players auth error:", error);
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

    const players = await getPlayersForLeagues(draft.sportLeagues);
    return jsonResponse(200, { players });
  } catch (error) {
    console.error("Get players error:", error);
    return jsonResponse(500, { message: "Failed to fetch players" });
  }
};
