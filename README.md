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
- `syncEspnPlayers.ts` — pulls free-agent rankings/injury status from your ESPN fantasy leagues and upserts them into the `Players` table. Manually invoked, not on a schedule or API route (see below).

## Scripts

- `pnpm seed:players -- --league NBA --file ./data/nba-players.json` — imports a player pool into the `Players` table (see `scripts/seed-players.ts`)

## Environment variables (set via Lambda config in Terraform)

`CONNECTIONS_TABLE`, `DRAFTS_TABLE`, `PLAYERS_TABLE`, `DRAFT_PICKS_TABLE`, `GOOGLE_CLIENT_ID`, `WEBSOCKET_MANAGEMENT_ENDPOINT`, `SCHEDULER_ROLE_ARN`, `PICK_TIMEOUT_FUNCTION_ARN`, `ESPN_CREDENTIALS_SECRET_ARN`

## Syncing players from ESPN (`syncEspnPlayers`)

Pulls free agents from an NFL and an NBA league you're in on ESPN and writes them into the `Players` table: top 100 QB, 100 RB, 200 WR, 100 TE, 50 K, and all D/ST for NFL, plus up to 1000 free agents (effectively all active players) for NBA. Each player is stored with its ESPN id as `playerId`, `name`, `realTeam`, `position`, `positions` (all real eligible positions), `ranking` (ESPN's positional rank), `injuryStatus`, and `estimatedReturnDate` (present when ESPN reports one, typically while injured). It only sees free agents - players already rostered on a team in your league won't show up (see `infrastructure/modules/player-sync/main.tf` for the reasoning).

**One-time setup - provide your ESPN authentication:**

`modules/player-sync` creates (but never populates) a Secrets Manager secret named `fantasy-draft/espn-credentials-<env>`. Terraform intentionally never touches its value, so espn_s2/SWID never land in Terraform state or this repo. After the first `terraform apply` creates the empty secret, set its value yourself:

1. Log into [espn.com](https://www.espn.com) in a browser, with access to both fantasy leagues you want synced.
2. Open DevTools → Application (Chrome) or Storage (Firefox) → Cookies → `https://www.espn.com`, and copy the values of the `espn_s2` and `SWID` cookies (`SWID` includes its `{...}` braces - copy it exactly).
3. Find each league's ID and season year from its URL, e.g. `https://fantasy.espn.com/football/league?leagueId=123456&seasonId=2026` → `leagueId=123456`, `year=2026`.
4. Put the secret value (replace the placeholders):

   ```sh
   aws secretsmanager put-secret-value \
     --secret-id fantasy-draft/espn-credentials-dev \
     --secret-string '{
       "espnS2": "<espn_s2 cookie value>",
       "swid": "{<SWID cookie value>}",
       "nfl": { "leagueId": "<your NFL league ID>", "year": 2026 },
       "nba": { "leagueId": "<your NBA league ID>", "year": 2026 }
     }'
   ```

   Repeat with `fantasy-draft/espn-credentials-prod` for prod. Re-run this whenever the cookies expire (ESPN sessions are long-lived but not permanent) or the season year rolls over.

**Running it:**

```sh
aws lambda invoke --function-name fantasy-draft-syncEspnPlayers-dev /dev/stdout
```

Safe to re-run any time - it upserts by ESPN player id, so repeated runs just refresh ranking/injury status rather than creating duplicates.

## Infrastructure (`infrastructure/`)

This repo owns the Terraform for everything that has to be built from its own `dist/` output: the REST API and WebSocket API Lambda functions, their IAM roles, log groups, and API Gateway routes (`infrastructure/modules/rest-api`, `infrastructure/modules/websocket-api`, wired together per environment under `infrastructure/envs/{dev,prod}`). This used to live in [megadraft-infra](https://github.com/whatsopdahl/megadraft-infra) and get built via a cross-repo checkout, which broke every time a new handler was added and the two repos' pushes landed out of order (or one hadn't landed yet). Moving the Terraform here removes that race by construction - one repo, one checkout, one CI run building and applying its own artifacts.

`megadraft-infra` still owns the DynamoDB tables, frontend hosting (S3/CloudFront/Route53), and the OIDC bootstrap - this repo's Terraform reconstructs the DynamoDB table names/ARNs it needs as plain locals (see `infrastructure/envs/*/main.tf`), since they're fully deterministic (`megadraft-<table>-<env>`, no random component) and don't need a cross-stack state lookup.

## Deploying (`.github/workflows/deploy.yml`, `terraform-plan.yml`)

Pushing to `main` builds this repo and runs `terraform apply` against `infrastructure/envs/dev` **in this same repo** (only Lambda functions whose code actually changed get updated - Terraform's own `source_code_hash` diffing handles that, nothing custom). Use the "Run workflow" button for `workflow_dispatch` to deploy any branch to `dev` or `prod` on demand. Pull requests into `main` run `terraform-plan.yml` for both envs first, so the infra diff is visible before merge.

One-time repo setup (Settings → Secrets and variables → Actions):

- **Secrets**: `AWS_DEPLOY_ROLE_ARN` (the `github_actions_deploy_role_arn` output from `megadraft-infra`'s `bootstrap/github-oidc.tf`) and `AWS_TERRAFORM_PLAN_ROLE_ARN` (the `github_actions_lambda_terraform_plan_role_arn` output from the same file). Both roles are scoped to Lambda functions, their IAM roles/log groups, API Gateway v2, and the `fantasy-draft/espn-credentials-*` secret container (never its value - see "Syncing players from ESPN" above) only - never DynamoDB table schema, Route53, ACM, CloudFront, or the frontend S3 bucket, which stay exclusively `megadraft-infra`'s.
- **Variables**: `GOOGLE_CLIENT_ID` (public value, matches `google_client_id` in `infrastructure/envs/*/*.tfvars.local`).
- **Environments**: create `dev` and `prod` environments (Settings → Environments). Add required reviewers on `prod` to gate production deploys behind manual approval - the deploy role's trust policy is scoped to runs executing under one of these environments.
- No more `INFRA_REPO_PAT` / `LAMBDA_REPO_PAT` cross-repo checkout tokens are needed by either repo's workflows - safe to revoke.
