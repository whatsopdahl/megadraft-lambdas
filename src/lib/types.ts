export type SportLeague = "NBA" | "NFL" ;
export type OrderType = "snake" | "linear";
export type DraftStatus = "pending" | "active" | "complete";

export interface FantasyTeam {
  fantasyTeamId: string;
  name: string;
  ownerUserId: string | null;
  color: string;
  autodraft: boolean;
}

export interface Draft {
  draftId: string;
  name: string;
  sportLeagues: SportLeague[];
  draftPasswordHash: string;
  orderType: OrderType;
  pickTimerSeconds: number;
  totalRounds: number;
  scheduledStartTime: string;
  status: DraftStatus;
  teams: FantasyTeam[];
  pickOrderTeamIds: string[];
  currentPickNumber: number;
  currentPickDeadline: string | null;
  draftedPlayerIds: string[];
  commissionerUserId: string;
  createdAt: string;
}

export interface Player {
  sportLeague: SportLeague;
  playerId: string;
  name: string;
  realTeam: string;
  position: string;
  /** All real (non-bench/IR/flex) positions this player is eligible at. */
  positions: string[];
  /** ESPN's positional ranking (e.g. RB12). */
  ranking: number;
  /** ESPN's overall ranking across all players in the sport, position-agnostic. */
  overallRanking: number;
  /** ESPN injury status, e.g. "ACTIVE", "QUESTIONABLE", "OUT", "INJURY_RESERVE". */
  injuryStatus: string;
  /** Only present when ESPN reports one (typically while injured). */
  estimatedReturnDate?: string;
}

export interface DraftPick {
  draftId: string;
  pickNumber: number;
  playerId: string;
  fantasyTeamId: string;
  pickedByUserId: string | null;
  pickedAt: string;
  auto: boolean;
}

export interface ConnectionRecord {
  connectionId: string;
  draftId: string;
  userId: string;
  connectedAt: string;
  expiresAt: number;
}

// Inbound WebSocket action messages (client -> server), routed by "action".
// createDraft/joinDraft live on the REST API (see handlers/createDraft.ts,
// handlers/joinDraft.ts) - the WebSocket API is draft-room-only.
export type InboundMessage =
  | { action: "startDraft"; draftId: string }
  | { action: "makePick"; draftId: string; playerId: string }
  | { action: "getDraftState"; draftId: string };

// Outbound broadcast messages (server -> clients)
export type OutboundMessage =
  | { type: "draftState"; draft: Draft; picks: DraftPick[]; players: Player[] }
  | { type: "pickMade"; pick: DraftPick; draft: Draft }
  | { type: "draftStarted"; draft: Draft }
  | { type: "draftUpdated"; draft: Draft }
  | { type: "error"; message: string };
