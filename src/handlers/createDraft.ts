import { APIGatewayProxyWebsocketHandlerV2 } from "aws-lambda";
import { randomUUID } from "node:crypto";
import { attachDraftToConnection, getConnection } from "../lib/connection.js";
import { sendToConnection } from "../lib/broadcast.js";
import { putDraft } from "../lib/draftRepo.js";
import { getPlayersForLeague } from "../lib/players.js";
import { hashPassword } from "../lib/password.js";
import type { InboundMessage, Draft } from "../lib/types.js";

export const handler: APIGatewayProxyWebsocketHandlerV2 = async (event) => {
  try {
    const connectionId = event.requestContext.connectionId;
    const body = JSON.parse(event.body ?? "{}") as InboundMessage;

    if (body.action !== "createDraft") {
      return { statusCode: 200, body: "" };
    }

    const connection = await getConnection(connectionId);
    if (!connection) {
      await sendToConnection(connectionId, { type: "error", message: "Not connected" });
      return { statusCode: 200, body: "" };
    }

    if (body.teamNames.length < 2) {
      await sendToConnection(connectionId, { type: "error", message: "A draft needs at least 2 teams" });
      return { statusCode: 200, body: "" };
    }

    const draftPasswordHash = await hashPassword(body.draftPassword);

    const teams = body.teamNames.map((name, i) => ({
      fantasyTeamId: randomUUID(),
      name,
      ownerUserId: i === 0 ? connection.userId : null,
    }));

    const draftId = randomUUID();

    const draft: Draft = {
      draftId,
      name: body.name,
      sportLeague: body.sportLeague,
      draftPasswordHash,
      orderType: body.orderType,
      pickTimerSeconds: body.pickTimerSeconds,
      totalRounds: body.totalRounds,
      status: "pending",
      teams,
      pickOrderTeamIds: teams.map((t) => t.fantasyTeamId),
      currentPickNumber: 1,
      currentPickDeadline: null,
      draftedPlayerIds: [],
      commissionerUserId: connection.userId,
      createdAt: new Date().toISOString(),
    };

    await putDraft(draft);
    await attachDraftToConnection(connectionId, draftId);

    const players = await getPlayersForLeague(draft.sportLeague);

    await sendToConnection(connectionId, { type: "draftState", draft, picks: [], players });

    return { statusCode: 200, body: "" };
  } catch (error) {
    console.error("Create draft error:", error);
    return { statusCode: 200, body: "" };
  }
};
