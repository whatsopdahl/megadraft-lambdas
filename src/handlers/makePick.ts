import { APIGatewayProxyWebsocketHandlerV2 } from "aws-lambda";
import { PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddb } from "../lib/dynamo.js";
import { env } from "../lib/env.js";
import { getConnection } from "../lib/connection.js";
import { sendToConnection, broadcastToDraft } from "../lib/broadcast.js";
import { getDraft } from "../lib/draftRepo.js";
import { getPlayerInLeagues } from "../lib/players.js";
import { teamIdForPick } from "../lib/draftOrder.js";
import { schedulePickTimeout, cancelPickTimeout } from "../lib/scheduler.js";
import { addRosterEntry, getTeamRoster } from "../lib/rosterRepo.js";
import { hasRosterCapacity } from "../lib/rosterConfig.js";
import type { InboundMessage } from "../lib/types.js";

export const handler: APIGatewayProxyWebsocketHandlerV2 = async (event) => {
  try {
    const connectionId = event.requestContext.connectionId;
    const body = JSON.parse(event.body ?? "{}") as InboundMessage;

    if (body.action !== "makePick") {
      return { statusCode: 200, body: "" };
    }

    const connection = await getConnection(connectionId);
    if (!connection) {
      await sendToConnection(connectionId, { type: "error", message: "Not connected" });
      return { statusCode: 200, body: "" };
    }

    const userId = connection.userId;

    const draft = await getDraft(body.draftId);
    if (!draft) {
      await sendToConnection(connectionId, { type: "error", message: "Draft not found" });
      return { statusCode: 200, body: "" };
    }

    if (draft.status !== "active") {
      await sendToConnection(connectionId, { type: "error", message: "Draft is not active" });
      return { statusCode: 200, body: "" };
    }

    const onClockTeamId = teamIdForPick(draft, draft.currentPickNumber);

    const callerTeam = draft.teams.find((t) => t.ownerUserId === userId);
    if (!callerTeam || callerTeam.fantasyTeamId !== onClockTeamId) {
      await sendToConnection(connectionId, { type: "error", message: "It's not your turn" });
      return { statusCode: 200, body: "" };
    }

    if (draft.draftedPlayerIds.includes(body.playerId)) {
      await sendToConnection(connectionId, { type: "error", message: "That player has already been drafted" });
      return { statusCode: 200, body: "" };
    }

    const player = await getPlayerInLeagues(draft.sportLeagues, body.playerId);
    if (!player) {
      await sendToConnection(connectionId, { type: "error", message: "Invalid player" });
      return { statusCode: 200, body: "" };
    }

    const teamRoster = await getTeamRoster(body.draftId, onClockTeamId);
    if (!hasRosterCapacity(draft.rosterConfig, teamRoster, player)) {
      await sendToConnection(connectionId, {
        type: "error",
        message: `No open ${player.position} or bench slot for that team`,
      });
      return { statusCode: 200, body: "" };
    }

    const pickNumber = draft.currentPickNumber;
    const totalPicks = draft.teams.length * draft.totalRounds;
    const isLastPick = pickNumber >= totalPicks;
    const nextPickNumber = pickNumber + 1;
    const nextDeadline = isLastPick ? null : new Date(Date.now() + draft.pickTimerSeconds * 1000);

    try {
      await ddb.send(
        new UpdateCommand({
          TableName: env.draftsTable,
          Key: { draftId: body.draftId },
          UpdateExpression:
            "SET currentPickNumber = :next, currentPickDeadline = :deadline, #status = :status, draftedPlayerIds = list_append(draftedPlayerIds, :newPlayer)",
          ConditionExpression: "currentPickNumber = :pickNumber AND NOT contains(draftedPlayerIds, :playerId)",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: {
            ":next": nextPickNumber,
            ":deadline": nextDeadline,
            ":status": isLastPick ? "complete" : "active",
            ":newPlayer": [body.playerId],
            ":pickNumber": pickNumber,
            ":playerId": body.playerId,
          },
        }),
      );
    } catch (error) {
      if ((error as { name?: string }).name === "ConditionalCheckFailedException") {
        await sendToConnection(connectionId, { type: "error", message: "That pick was already made" });
        return { statusCode: 200, body: "" };
      }
      throw error;
    }

    const pickedAt = new Date().toISOString();

    await ddb.send(
      new PutCommand({
        TableName: env.draftPicksTable,
        Item: {
          draftId: body.draftId,
          pickNumber,
          playerId: body.playerId,
          fantasyTeamId: onClockTeamId,
          pickedByUserId: userId,
          pickedAt,
          auto: false,
        },
      }),
    );

    await addRosterEntry(body.draftId, {
      fantasyTeamId: onClockTeamId,
      playerId: body.playerId,
      position: player.position,
      sportLeague: player.sportLeague,
      pickNumber,
      pickedByUserId: userId,
      pickedAt,
    });

    await cancelPickTimeout(body.draftId, pickNumber);

    if (!isLastPick) {
      await schedulePickTimeout(body.draftId, nextPickNumber, nextDeadline!);
    }

    const updatedDraft = await getDraft(body.draftId);
    if (updatedDraft) {
      await broadcastToDraft(body.draftId, {
        type: "pickMade",
        pick: {
          draftId: body.draftId,
          pickNumber,
          playerId: body.playerId,
          fantasyTeamId: onClockTeamId,
          pickedByUserId: userId,
          pickedAt,
          auto: false,
        },
        draft: updatedDraft,
      });
    }

    return { statusCode: 200, body: "" };
  } catch (error) {
    console.error("Make pick error:", error);
    return { statusCode: 200, body: "" };
  }
};
