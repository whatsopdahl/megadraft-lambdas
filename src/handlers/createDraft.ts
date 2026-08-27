import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { randomUUID } from "node:crypto";
import { requireAuth, jsonResponse } from "../lib/http.js";
import { putDraft } from "../lib/draftRepo.js";
import { createRosterTable } from "../lib/rosterRepo.js";
import { claimTeamsByEmail } from "../lib/teamClaims.js";
import { DEFAULT_TEAM_COLORS } from "../lib/teamColors.js";
import { computeTotalRounds, validateRosterConfig } from "../lib/rosterConfig.js";
import type { Draft, OrderType } from "../lib/types.js";

interface CreateDraftBody {
  name: string;
  orderType: OrderType;
  pickTimerSeconds: number;
  rosterConfig: unknown;
  scheduledStartTime: string;
  teams: { name: string; email: string }[];
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  let user;
  try {
    user = await requireAuth(event);
  } catch (error) {
    console.error("Create draft auth error:", error);
    return jsonResponse(401, { message: "Unauthorized" });
  }

  try {
    const body = JSON.parse(event.body ?? "{}") as Partial<CreateDraftBody>;

    if (!body.name || !body.orderType || !body.pickTimerSeconds || !body.scheduledStartTime) {
      return jsonResponse(400, { message: "Missing required fields" });
    }

    if (Number.isNaN(new Date(body.scheduledStartTime).getTime())) {
      return jsonResponse(400, { message: "Invalid scheduledStartTime" });
    }

    if (!Array.isArray(body.teams) || body.teams.length < 2) {
      return jsonResponse(400, { message: "A draft needs at least 2 teams" });
    }

    if (body.teams.some((t) => !t.name || !t.email)) {
      return jsonResponse(400, { message: "Every team needs a name and an email" });
    }

    const rosterConfig = validateRosterConfig(body.rosterConfig);
    if (!rosterConfig) {
      return jsonResponse(400, { message: "Invalid roster configuration" });
    }

    const totalRounds = computeTotalRounds(rosterConfig);
    if (totalRounds === 0) {
      return jsonResponse(400, { message: "Roster configuration must include at least one slot" });
    }

    const teams = body.teams.map(({ name, email }, i) => ({
      fantasyTeamId: randomUUID(),
      name,
      email,
      ownerUserId: null,
      color: DEFAULT_TEAM_COLORS[i % DEFAULT_TEAM_COLORS.length],
      autodraft: false,
    }));

    const draftId = randomUUID();

    const draft: Draft = {
      draftId,
      name: body.name,
      sportLeagues: ["NBA", "NFL"],
      orderType: body.orderType,
      pickTimerSeconds: body.pickTimerSeconds,
      totalRounds,
      rosterConfig,
      scheduledStartTime: body.scheduledStartTime,
      status: "pending",
      teams: claimTeamsByEmail(teams, user).teams,
      pickOrderTeamIds: teams.map((t) => t.fantasyTeamId),
      currentPickNumber: 1,
      currentPickDeadline: null,
      draftedPlayerIds: [],
      commissionerUserId: user.userId,
      createdAt: new Date().toISOString(),
    };

    await putDraft(draft);
    await createRosterTable(draftId);

    return jsonResponse(201, { draft });
  } catch (error) {
    console.error("Create draft error:", error);
    return jsonResponse(500, { message: "Failed to create draft" });
  }
};
