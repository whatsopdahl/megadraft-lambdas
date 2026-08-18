# fantasy-draft-lambdas

TypeScript Lambda handlers for the Fantasy Draft WebSocket backend (API Gateway WebSocket API + DynamoDB + EventBridge Scheduler).

## Setup

```sh
pnpm install
pnpm build   # bundles each handler with esbuild into dist/
```

## Handlers (`src/handlers`)

- `connect.ts` — `$connect` route; Cognito ID-token verification, writes a `Connections` item
- `disconnect.ts` — `$disconnect` route; removes the `Connections` item
- `createDraft.ts` / `joinDraft.ts` — draft creation and password-gated join
- `startDraft.ts` — computes initial pick order (snake/linear), starts the first pick timer
- `makePick.ts` — records a pick, advances turn, (re)schedules the pick timer
- `pickTimeout.ts` — EventBridge Scheduler target; auto-skips/advances an expired pick
- `getDraftState.ts` — returns current draft + picks snapshot

## Scripts

- `pnpm seed:players -- --league NBA --file ./data/nba-players.json` — imports a player pool into the `Players` table (see `scripts/seed-players.ts`)

## Environment variables (set via Lambda config in Terraform)

`CONNECTIONS_TABLE`, `DRAFTS_TABLE`, `PLAYERS_TABLE`, `DRAFT_PICKS_TABLE`, `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, `WEBSOCKET_MANAGEMENT_ENDPOINT`, `SCHEDULER_ROLE_ARN`, `PICK_TIMEOUT_FUNCTION_ARN`
