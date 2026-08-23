# fantasy-draft-lambdas

TypeScript Lambda handlers for the Fantasy Draft WebSocket backend (API Gateway WebSocket API + DynamoDB + EventBridge Scheduler).

## Setup

```sh
pnpm install
pnpm build   # bundles each handler with esbuild into dist/
```

## Handlers (`src/handlers`)

- `connect.ts` — `$connect` route; Google ID-token verification, writes a `Connections` item
- `disconnect.ts` — `$disconnect` route; removes the `Connections` item
- `createDraft.ts` / `joinDraft.ts` — draft creation and password-gated join
- `startDraft.ts` — computes initial pick order (snake/linear), starts the first pick timer
- `makePick.ts` — records a pick, advances turn, (re)schedules the pick timer
- `pickTimeout.ts` — EventBridge Scheduler target; auto-skips/advances an expired pick
- `getDraftState.ts` — returns current draft + picks snapshot

## Scripts

- `pnpm seed:players -- --league NBA --file ./data/nba-players.json` — imports a player pool into the `Players` table (see `scripts/seed-players.ts`)

## Environment variables (set via Lambda config in Terraform)

`CONNECTIONS_TABLE`, `DRAFTS_TABLE`, `PLAYERS_TABLE`, `DRAFT_PICKS_TABLE`, `GOOGLE_CLIENT_ID`, `WEBSOCKET_MANAGEMENT_ENDPOINT`, `SCHEDULER_ROLE_ARN`, `PICK_TIMEOUT_FUNCTION_ARN`

## Deploying (`.github/workflows/deploy.yml`)

Pushing to `main` builds this repo and runs `terraform apply` against `envs/dev` in [megadraft-infra](https://github.com/whatsopdahl/megadraft-infra) (only Lambda functions whose code actually changed get updated - Terraform's own `source_code_hash` diffing handles that, nothing custom). Use the "Run workflow" button for `workflow_dispatch` to deploy any branch to `dev` or `prod` on demand.

One-time repo setup (Settings → Secrets and variables → Actions):

- **Secrets**: `AWS_DEPLOY_ROLE_ARN` (the `github_actions_deploy_role_arn` output from `infrastructure/bootstrap`, after applying its `github-oidc.tf`), `INFRA_REPO_PAT` (a token with read access to the private `megadraft-infra` repo, for the cross-repo checkout).
- **Variables**: `GOOGLE_CLIENT_ID` (public value, matches `google_client_id` in the infra repo's `*.tfvars.local`).
- **Environments**: create `dev` and `prod` environments (Settings → Environments). Add required reviewers on `prod` to gate production deploys behind manual approval - the deploy role's trust policy is scoped to runs executing under one of these environments.
