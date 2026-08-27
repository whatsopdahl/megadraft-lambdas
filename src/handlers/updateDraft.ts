import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { randomUUID } from "node:crypto";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddb } from "../lib/dynamo.js";
import { env } from "../lib/env.js";
import { requireAuth, jsonResponse, sanitizeDraft } from "../lib/http.js";
import { broadcastToDraft } from "../lib/broadcast.js";
import { getDraft } from "../lib/draftRepo.js";
import { hashPassword } from "../lib/password.js";
import { DEFAULT_TEAM_COLORS } from "../lib/teamColors.js";
import type { OrderType } from "../lib/types.js";

interface UpdateDraftBody {
  name?: string;
  orderType?: OrderType;
  pickTimerSeconds?: number;
  totalRounds?: number;
  scheduledStartTime?: string;
  draftPassword?: string;
  teamNames?: string[];
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  let user;
  try {
    user = await requireAuth(event);
  } catch (error) {
    console.error("Update draft auth error:", error);
    return jsonResponse(401, { message: "Unauthorized" });
  }

  try {
    const draftId = event.pathParameters?.draftId;
    if (!draftId) {
      return jsonResponse(400, { message: "Missing draftId" });
    }

    const body = JSON.parse(event.body ?? "{}") as UpdateDraftBody;

    const draft = await getDraft(draftId);
    if (!draft) {
      return jsonResponse(404, { message: "Draft not found" });
    }

    if (draft.commissionerUserId !== user.userId) {
      return jsonResponse(403, { message: "Only the commissioner can edit the draft" });
    }

    if (draft.status !== "pending") {
      return jsonResponse(409, { message: "Draft can no longer be edited" });
    }

    if (body.name !== undefined) {
      draft.name = body.name;
    }
    if (body.orderType !== undefined) {
      draft.orderType = body.orderType;
    }
    if (body.pickTimerSeconds !== undefined) {
      draft.pickTimerSeconds = body.pickTimerSeconds;
    }
    if (body.totalRounds !== undefined) {
      draft.totalRounds = body.totalRounds;
    }
    if (body.scheduledStartTime !== undefined) {
      if (Number.isNaN(new Date(body.scheduledStartTime).getTime())) {
        return jsonResponse(400, { message: "Invalid scheduledStartTime" });
      }
      draft.scheduledStartTime = body.scheduledStartTime;
    }
    if (body.draftPassword !== undefined) {
      draft.draftPasswordHash = await hashPassword(body.draftPassword);
    }
    if (body.teamNames !== undefined) {
      if (!Array.isArray(body.teamNames) || body.teamNames.length < 2) {
        return jsonResponse(400, { message: "A draft needs at least 2 teams" });
      }

      // A team's ownership/autodraft setting only needs to reset when its
      // identity actually changes (renamed, or the slot is new) - otherwise
      // an unrelated edit elsewhere in this form (e.g. the pick timer) would
      // silently un-claim every already-claimed team.
      draft.teams = body.teamNames.map((name, i) => {
        const existing = draft.teams[i];
        const unchanged = existing?.name === name;
        return {
          fantasyTeamId: existing?.fantasyTeamId ?? randomUUID(),
          name,
          ownerUserId: unchanged ? (existing?.ownerUserId ?? null) : null,
          color: existing?.color ?? DEFAULT_TEAM_COLORS[i % DEFAULT_TEAM_COLORS.length],
          autodraft: unchanged ? (existing?.autodraft ?? false) : false,
        };
      });
      draft.pickOrderTeamIds = draft.teams.map((t) => t.fantasyTeamId);
    }

    try {
      await ddb.send(
        new PutCommand({
          TableName: env.draftsTable,
          Item: draft,
          ConditionExpression: "#status = :pending",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: { ":pending": "pending" },
        }),
      );
    } catch (error) {
      if ((error as { name?: string }).name === "ConditionalCheckFailedException") {
        return jsonResponse(409, { message: "Draft can no longer be edited" });
      }
      throw error;
    }

    await broadcastToDraft(draftId, { type: "draftUpdated", draft });

    return jsonResponse(200, { draft: sanitizeDraft(draft) });
  } catch (error) {
    console.error("Update draft error:", error);
    return jsonResponse(500, { message: "Failed to update draft" });
  }
};
