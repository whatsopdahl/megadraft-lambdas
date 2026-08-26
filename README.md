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

## Infrastructure (`infrastructure/`)

This repo owns the Terraform for everything that has to be built from its own `dist/` output: the REST API and WebSocket API Lambda functions, their IAM roles, log groups, and API Gateway routes (`infrastructure/modules/rest-api`, `infrastructure/modules/websocket-api`, wired together per environment under `infrastructure/envs/{dev,prod}`). This used to live in [megadraft-infra](https://github.com/whatsopdahl/megadraft-infra) and get built via a cross-repo checkout, which broke every time a new handler was added and the two repos' pushes landed out of order (or one hadn't landed yet). Moving the Terraform here removes that race by construction - one repo, one checkout, one CI run building and applying its own artifacts.

`megadraft-infra` still owns the DynamoDB tables, frontend hosting (S3/CloudFront/Route53), and the OIDC bootstrap - this repo's Terraform reconstructs the DynamoDB table names/ARNs it needs as plain locals (see `infrastructure/envs/*/main.tf`), since they're fully deterministic (`megadraft-<table>-<env>`, no random component) and don't need a cross-stack state lookup.

## Deploying (`.github/workflows/deploy.yml`, `terraform-plan.yml`)

Pushing to `main` builds this repo and runs `terraform apply` against `infrastructure/envs/dev` **in this same repo** (only Lambda functions whose code actually changed get updated - Terraform's own `source_code_hash` diffing handles that, nothing custom). Use the "Run workflow" button for `workflow_dispatch` to deploy any branch to `dev` or `prod` on demand. Pull requests into `main` run `terraform-plan.yml` for both envs first, so the infra diff is visible before merge.

One-time repo setup (Settings → Secrets and variables → Actions):

- **Secrets**: `AWS_DEPLOY_ROLE_ARN` (the `github_actions_deploy_role_arn` output from `megadraft-infra`'s `bootstrap/github-oidc.tf`) and `AWS_TERRAFORM_PLAN_ROLE_ARN` (the `github_actions_lambda_terraform_plan_role_arn` output from the same file). Both roles are scoped to Lambda functions, their IAM roles/log groups, and API Gateway v2 only - never DynamoDB table schema, Route53, ACM, CloudFront, or the frontend S3 bucket, which stay exclusively `megadraft-infra`'s.
- **Variables**: `GOOGLE_CLIENT_ID` (public value, matches `google_client_id` in `infrastructure/envs/*/*.tfvars.local`).
- **Environments**: create `dev` and `prod` environments (Settings → Environments). Add required reviewers on `prod` to gate production deploys behind manual approval - the deploy role's trust policy is scoped to runs executing under one of these environments.
- No more `INFRA_REPO_PAT` / `LAMBDA_REPO_PAT` cross-repo checkout tokens are needed by either repo's workflows - safe to revoke.
