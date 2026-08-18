export type SportLeague = "NBA" | "NFL" | "MLB";
export type OrderType = "snake" | "linear";
export type DraftStatus = "pending" | "active" | "complete";

export interface FantasyTeam {
  fantasyTeamId: string;
  name: string;
  ownerUserId: string | null;
}

export interface Draft {
  draftId: string;
  name: string;
  sportLeague: SportLeague;
  draftPasswordHash: string;
  orderType: OrderType;
  pickTimerSeconds: number;
  totalRounds: number;
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

// Inbound WebSocket action messages (client -> server), routed by "action"
export type InboundMessage =
  | { action: "createDraft"; name: string; sportLeague: SportLeague; draftPassword: string; orderType: OrderType; pickTimerSeconds: number; totalRounds: number; teamNames: string[] }
  | { action: "joinDraft"; draftId: string; draftPassword: string; fantasyTeamId: string }
  | { action: "startDraft"; draftId: string }
  | { action: "makePick"; draftId: string; playerId: string }
  | { action: "getDraftState"; draftId: string };

// Outbound broadcast messages (server -> clients)
export type OutboundMessage =
  | { type: "draftState"; draft: Draft; picks: DraftPick[]; players: Player[] }
  | { type: "pickMade"; pick: DraftPick; draft: Draft }
  | { type: "draftStarted"; draft: Draft }
  | { type: "error"; message: string };
