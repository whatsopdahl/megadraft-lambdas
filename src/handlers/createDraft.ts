import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { randomUUID } from "node:crypto";
import { requireAuth, jsonResponse, sanitizeDraft } from "../lib/http.js";
import { putDraft } from "../lib/draftRepo.js";
import { createRosterTable } from "../lib/rosterRepo.js";
import { hashPassword } from "../lib/password.js";
import { DEFAULT_TEAM_COLORS } from "../lib/teamColors.js";
import type { Draft, OrderType } from "../lib/types.js";

interface CreateDraftBody {
  name: string;
  draftPassword: string;
  orderType: OrderType;
  pickTimerSeconds: number;
  totalRounds: number;
  scheduledStartTime: string;
  teamNames: string[];
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

    if (
      !body.name ||
      !body.draftPassword ||
      !body.orderType ||
      !body.pickTimerSeconds ||
      !body.totalRounds ||
      !body.scheduledStartTime
    ) {
      return jsonResponse(400, { message: "Missing required fields" });
    }

    if (Number.isNaN(new Date(body.scheduledStartTime).getTime())) {
      return jsonResponse(400, { message: "Invalid scheduledStartTime" });
    }

    if (!Array.isArray(body.teamNames) || body.teamNames.length < 2) {
      return jsonResponse(400, { message: "A draft needs at least 2 teams" });
    }

    const draftPasswordHash = await hashPassword(body.draftPassword);

    const teams = body.teamNames.map((name, i) => ({
      fantasyTeamId: randomUUID(),
      name,
      ownerUserId: i === 0 ? user.userId : null,
      color: DEFAULT_TEAM_COLORS[i % DEFAULT_TEAM_COLORS.length],
      autodraft: false,
    }));

    const draftId = randomUUID();

    const draft: Draft = {
      draftId,
      name: body.name,
      sportLeagues: ["NBA", "NFL"],
      draftPasswordHash,
      orderType: body.orderType,
      pickTimerSeconds: body.pickTimerSeconds,
      totalRounds: body.totalRounds,
      scheduledStartTime: body.scheduledStartTime,
      status: "pending",
      teams,
      pickOrderTeamIds: teams.map((t) => t.fantasyTeamId),
      currentPickNumber: 1,
      currentPickDeadline: null,
      draftedPlayerIds: [],
      commissionerUserId: user.userId,
      createdAt: new Date().toISOString(),
    };

    await putDraft(draft);
    await createRosterTable(draftId);

    return jsonResponse(201, { draft: sanitizeDraft(draft) });
  } catch (error) {
    console.error("Create draft error:", error);
    return jsonResponse(500, { message: "Failed to create draft" });
  }
};
