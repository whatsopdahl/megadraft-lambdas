import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { randomUUID } from "node:crypto";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddb } from "../lib/dynamo.js";
import { env } from "../lib/env.js";
import { requireAuth, jsonResponse } from "../lib/http.js";
import { broadcastToDraft } from "../lib/broadcast.js";
import { getDraft } from "../lib/draftRepo.js";
import { claimTeamsByEmail } from "../lib/teamClaims.js";
import { DEFAULT_TEAM_COLORS } from "../lib/teamColors.js";
import { computeTotalRounds, validateRosterConfig } from "../lib/rosterConfig.js";
import type { OrderType } from "../lib/types.js";

interface UpdateDraftBody {
  name?: string;
  orderType?: OrderType;
  pickTimerSeconds?: number;
  rosterConfig?: unknown;
  scheduledStartTime?: string;
  teams?: { name: string; email: string; fantasyTeamId?: string; autodraft?: boolean }[];
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
    if (body.rosterConfig !== undefined) {
      const rosterConfig = validateRosterConfig(body.rosterConfig);
      if (!rosterConfig) {
        return jsonResponse(400, { message: "Invalid roster configuration" });
      }
      const totalRounds = computeTotalRounds(rosterConfig);
      if (totalRounds === 0) {
        return jsonResponse(400, { message: "Roster configuration must include at least one slot" });
      }
      draft.rosterConfig = rosterConfig;
      draft.totalRounds = totalRounds;
    }
    if (body.scheduledStartTime !== undefined) {
      if (Number.isNaN(new Date(body.scheduledStartTime).getTime())) {
        return jsonResponse(400, { message: "Invalid scheduledStartTime" });
      }
      draft.scheduledStartTime = body.scheduledStartTime;
    }
    if (body.teams !== undefined) {
      if (!Array.isArray(body.teams) || body.teams.length < 2) {
        return jsonResponse(400, { message: "A draft needs at least 2 teams" });
      }
      if (body.teams.some((t) => !t.name || !t.email)) {
        return jsonResponse(400, { message: "Every team needs a name and an email" });
      }

      // A team's ownership setting only needs to reset when its identity
      // actually changes (renamed/re-invited, or the slot is new) -
      // otherwise an unrelated edit elsewhere in this form (e.g. the pick
      // timer) would silently un-claim every already-claimed team. Teams are
      // matched by fantasyTeamId rather than array index so that reordering
      // the list (to set draft order) doesn't get misread as every team
      // changing identity. Autodraft is commissioner-settable directly from
      // this form, so an explicit value in the request always wins; only
      // fall back to the identity-based reset when the field is omitted.
      const existingById = new Map(draft.teams.map((t) => [t.fantasyTeamId, t]));
      const teams = body.teams.map(({ name, email, fantasyTeamId, autodraft }, i) => {
        const existing = fantasyTeamId ? existingById.get(fantasyTeamId) : undefined;
        const unchanged = !!existing && existing.name === name && existing.email === email;
        return {
          fantasyTeamId: existing?.fantasyTeamId ?? randomUUID(),
          name,
          email,
          ownerUserId: unchanged ? (existing?.ownerUserId ?? null) : null,
          color: existing?.color ?? DEFAULT_TEAM_COLORS[i % DEFAULT_TEAM_COLORS.length],
          autodraft: autodraft !== undefined ? autodraft : unchanged ? (existing?.autodraft ?? false) : false,
        };
      });
      draft.teams = claimTeamsByEmail(teams, user).teams;
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

    return jsonResponse(200, { draft });
  } catch (error) {
    console.error("Update draft error:", error);
    return jsonResponse(500, { message: "Failed to update draft" });
  }
};
