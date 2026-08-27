import { PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddb } from "../lib/dynamo.js";
import { env } from "../lib/env.js";
import { getDraft } from "../lib/draftRepo.js";
import { getPlayersForLeagues } from "../lib/players.js";
import { broadcastToDraft } from "../lib/broadcast.js";
import { teamIdForPick } from "../lib/draftOrder.js";
import { schedulePickTimeout } from "../lib/scheduler.js";
import { addRosterEntry, getTeamRoster } from "../lib/rosterRepo.js";
import { hasRosterCapacity } from "../lib/rosterConfig.js";

export const handler = async (event: { draftId: string; pickNumber: number }): Promise<void> => {
  try {
    const draft = await getDraft(event.draftId);

    if (!draft || draft.status !== "active" || draft.currentPickNumber !== event.pickNumber) {
      return;
    }

    const onClockTeamId = teamIdForPick(draft, event.pickNumber);

    const players = await getPlayersForLeagues(draft.sportLeagues);
    const available = players.filter((p) => !draft.draftedPlayerIds.includes(p.playerId));

    if (available.length === 0) {
      console.error(`No available players for auto-pick in draft ${event.draftId}, pick ${event.pickNumber}`);
      return;
    }

    const teamRoster = await getTeamRoster(event.draftId, onClockTeamId);
    const eligible = available.filter((p) => hasRosterCapacity(draft.rosterConfig, teamRoster, p));
    if (eligible.length === 0) {
      console.error(
        `No roster-eligible players for auto-pick in draft ${event.draftId}, pick ${event.pickNumber} - falling back to best available`,
      );
    }
    const autoPlayer = eligible.length > 0 ? eligible[0] : available[0];

    const pickNumber = event.pickNumber;
    const totalPicks = draft.teams.length * draft.totalRounds;
    const isLastPick = pickNumber >= totalPicks;
    const nextPickNumber = pickNumber + 1;
    const nextDeadline = isLastPick ? null : new Date(Date.now() + draft.pickTimerSeconds * 1000);

    try {
      await ddb.send(
        new UpdateCommand({
          TableName: env.draftsTable,
          Key: { draftId: event.draftId },
          UpdateExpression:
            "SET currentPickNumber = :next, currentPickDeadline = :deadline, #status = :status, draftedPlayerIds = list_append(draftedPlayerIds, :newPlayer)",
          ConditionExpression: "currentPickNumber = :pickNumber AND NOT contains(draftedPlayerIds, :playerId)",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: {
            ":next": nextPickNumber,
            ":deadline": nextDeadline,
            ":status": isLastPick ? "complete" : "active",
            ":newPlayer": [autoPlayer.playerId],
            ":pickNumber": pickNumber,
            ":playerId": autoPlayer.playerId,
          },
        }),
      );
    } catch (error) {
      if ((error as { name?: string }).name === "ConditionalCheckFailedException") {
        return;
      }
      throw error;
    }

    const pickedAt = new Date().toISOString();

    await ddb.send(
      new PutCommand({
        TableName: env.draftPicksTable,
        Item: {
          draftId: event.draftId,
          pickNumber,
          playerId: autoPlayer.playerId,
          fantasyTeamId: onClockTeamId,
          pickedByUserId: null,
          pickedAt,
          auto: true,
        },
      }),
    );

    await addRosterEntry(event.draftId, {
      fantasyTeamId: onClockTeamId,
      playerId: autoPlayer.playerId,
      position: autoPlayer.position,
      sportLeague: autoPlayer.sportLeague,
      pickNumber,
      pickedByUserId: null,
      pickedAt,
    });

    if (!isLastPick) {
      await schedulePickTimeout(event.draftId, nextPickNumber, nextDeadline!);
    }

    const updatedDraft = await getDraft(event.draftId);
    if (updatedDraft) {
      await broadcastToDraft(event.draftId, {
        type: "pickMade",
        pick: {
          draftId: event.draftId,
          pickNumber,
          playerId: autoPlayer.playerId,
          fantasyTeamId: onClockTeamId,
          pickedByUserId: null,
          pickedAt,
          auto: true,
        },
        draft: updatedDraft,
      });
    }
  } catch (error) {
    console.error("Pick timeout error:", error);
    throw error;
  }
};
