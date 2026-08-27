import { PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddb } from "./dynamo.js";
import { env } from "./env.js";
import { getDraft } from "./draftRepo.js";
import { getPlayersForLeagues } from "./players.js";
import { broadcastToDraft } from "./broadcast.js";
import { teamIdForPick } from "./draftOrder.js";
import { schedulePickTimeout } from "./scheduler.js";
import { addRosterEntry, getTeamRoster } from "./rosterRepo.js";
import { hasRosterCapacity } from "./rosterConfig.js";
import type { Player } from "./types.js";

// ESPN's overall ranking is position-agnostic (1 = best); 0 means ESPN has no
// overall rank for that player, so it must sort last, not first - mirrors
// PlayerSearch.tsx's frontend sort so autodraft and manual search agree on
// "best available".
function overallRankValue(player: Player): number {
  return player.overallRanking === 0 ? Infinity : player.overallRanking;
}

function bestByOverallRanking(players: Player[]): Player {
  return players.reduce((best, p) => (overallRankValue(p) < overallRankValue(best) ? p : best));
}

/**
 * Runs the auto-pick for a drafted-out pick. Safe to call redundantly/
 * concurrently (from EventBridge's pickTimeout invocation and/or one or more
 * connected clients' checkPickTimeout triggers) - the conditional update
 * below means only the first caller to reach it actually applies the pick,
 * everyone else no-ops.
 */
export async function performAutoPick(draftId: string, pickNumber: number): Promise<void> {
  const draft = await getDraft(draftId);

  if (!draft || draft.status !== "active" || draft.currentPickNumber !== pickNumber) {
    return;
  }

  const onClockTeamId = teamIdForPick(draft, pickNumber);

  const [players, teamRoster] = await Promise.all([
    getPlayersForLeagues(draft.sportLeagues),
    getTeamRoster(draftId, onClockTeamId),
  ]);
  const available = players.filter((p) => !draft.draftedPlayerIds.includes(p.playerId));

  if (available.length === 0) {
    console.error(`No available players for auto-pick in draft ${draftId}, pick ${pickNumber}`);
    return;
  }

  const eligible = available.filter((p) => hasRosterCapacity(draft.rosterConfig, teamRoster, p));
  if (eligible.length === 0) {
    console.error(
      `No roster-eligible players for auto-pick in draft ${draftId}, pick ${pickNumber} - falling back to best available`,
    );
  }

  let autoPlayer: Player;
  if (eligible.length > 0) {
    // Leagues this team still has an open roster spot for, in the draft's
    // declared league order (used as a deterministic tiebreak below). A
    // league drops out here on its own once its roster (positions + bench)
    // is completely full, since no player in it would then pass
    // hasRosterCapacity.
    const openLeagues = draft.sportLeagues.filter((league) => eligible.some((p) => p.sportLeague === league));

    // Alternate leagues: draft from whichever open league this team has
    // picked fewest players in so far. With picks landing one at a time this
    // naturally ping-pongs between leagues instead of filling one before
    // touching the other, and automatically stops alternating into a league
    // once it fills (it's no longer in openLeagues).
    const targetLeague = openLeagues.reduce((leastDrafted, league) => {
      const leagueCount = teamRoster.filter((e) => e.sportLeague === league).length;
      const leastDraftedCount = teamRoster.filter((e) => e.sportLeague === leastDrafted).length;
      return leagueCount < leastDraftedCount ? league : leastDrafted;
    });

    autoPlayer = bestByOverallRanking(eligible.filter((p) => p.sportLeague === targetLeague));
  } else {
    autoPlayer = bestByOverallRanking(available);
  }

  const totalPicks = draft.teams.length * draft.totalRounds;
  const isLastPick = pickNumber >= totalPicks;
  const nextPickNumber = pickNumber + 1;
  const nextDeadline = isLastPick ? null : new Date(Date.now() + draft.pickTimerSeconds * 1000);

  try {
    await ddb.send(
      new UpdateCommand({
        TableName: env.draftsTable,
        Key: { draftId },
        UpdateExpression:
          "SET currentPickNumber = :next, currentPickDeadline = :deadline, #status = :status, draftedPlayerIds = list_append(draftedPlayerIds, :newPlayer)",
        ConditionExpression: "currentPickNumber = :pickNumber AND NOT contains(draftedPlayerIds, :playerId)",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":next": nextPickNumber,
          ":deadline": nextDeadline ? nextDeadline.toISOString() : null,
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

  await Promise.all([
    ddb.send(
      new PutCommand({
        TableName: env.draftPicksTable,
        Item: {
          draftId,
          pickNumber,
          playerId: autoPlayer.playerId,
          playerName: autoPlayer.name,
          playerPosition: autoPlayer.position,
          sportLeague: autoPlayer.sportLeague,
          fantasyTeamId: onClockTeamId,
          pickedByUserId: null,
          pickedAt,
          auto: true,
        },
      }),
    ),
    addRosterEntry(draftId, {
      fantasyTeamId: onClockTeamId,
      playerId: autoPlayer.playerId,
      position: autoPlayer.position,
      sportLeague: autoPlayer.sportLeague,
      pickNumber,
      pickedByUserId: null,
      pickedAt,
    }),
  ]);

  const updatedDraft = {
    ...draft,
    currentPickNumber: nextPickNumber,
    currentPickDeadline: nextDeadline ? nextDeadline.toISOString() : null,
    status: isLastPick ? ("complete" as const) : ("active" as const),
    draftedPlayerIds: [...draft.draftedPlayerIds, autoPlayer.playerId],
  };

  await Promise.all([
    isLastPick ? Promise.resolve() : schedulePickTimeout(draftId, nextPickNumber, nextDeadline!),
    broadcastToDraft(draftId, {
      type: "pickMade",
      pick: {
        draftId,
        pickNumber,
        playerId: autoPlayer.playerId,
        playerName: autoPlayer.name,
        playerPosition: autoPlayer.position,
        sportLeague: autoPlayer.sportLeague,
        fantasyTeamId: onClockTeamId,
        pickedByUserId: null,
        pickedAt,
        auto: true,
      },
      draft: updatedDraft,
    }),
  ]);
}
