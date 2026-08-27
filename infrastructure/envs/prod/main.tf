data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  cors_allow_origins = ["https://${var.subdomain}.${var.root_domain}"]

  # The dynamodb module lives in the infrastructure repo now, not here. Every
  # one of these names/ARNs is fully deterministic (no random component), so
  # they're recomputed locally instead of reaching across a Terraform state
  # boundary for them.
  dynamodb_table_arn_prefix = "arn:aws:dynamodb:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:table"

  connections_table_name = "megadraft-connections-${var.env}"
  connections_table_arn  = "${local.dynamodb_table_arn_prefix}/${local.connections_table_name}"
  drafts_table_name      = "megadraft-drafts-${var.env}"
  drafts_table_arn       = "${local.dynamodb_table_arn_prefix}/${local.drafts_table_name}"
  players_table_name     = "megadraft-players-${var.env}"
  players_table_arn      = "${local.dynamodb_table_arn_prefix}/${local.players_table_name}"
  draft_picks_table_name = "megadraft-draft-picks-${var.env}"
  draft_picks_table_arn  = "${local.dynamodb_table_arn_prefix}/${local.draft_picks_table_name}"
}

module "websocket_api" {
  source = "../../modules/websocket-api"

  env                = var.env
  lambda_dist_dir    = var.lambda_dist_dir
  log_retention_days = var.log_retention_days

  connections_table_name = local.connections_table_name
  connections_table_arn  = local.connections_table_arn
  drafts_table_name      = local.drafts_table_name
  drafts_table_arn       = local.drafts_table_arn
  players_table_name     = local.players_table_name
  players_table_arn      = local.players_table_arn
  draft_picks_table_name = local.draft_picks_table_name
  draft_picks_table_arn  = local.draft_picks_table_arn

  google_client_id = var.google_client_id
}

module "rest_api" {
  source = "../../modules/rest-api"

  env                = var.env
  lambda_dist_dir    = var.lambda_dist_dir
  log_retention_days = var.log_retention_days

  drafts_table_name      = local.drafts_table_name
  drafts_table_arn       = local.drafts_table_arn
  connections_table_name = local.connections_table_name
  connections_table_arn  = local.connections_table_arn
  players_table_name     = local.players_table_name
  players_table_arn      = local.players_table_arn
  draft_picks_table_name = local.draft_picks_table_name
  draft_picks_table_arn  = local.draft_picks_table_arn

  google_client_id   = var.google_client_id
  cors_allow_origins = local.cors_allow_origins

  websocket_execution_arn       = module.websocket_api.execution_arn
  websocket_management_endpoint = module.websocket_api.management_endpoint
}

module "player_sync" {
  source = "../../modules/player-sync"

  env                = var.env
  lambda_dist_dir    = var.lambda_dist_dir
  log_retention_days = var.log_retention_days

  players_table_name = local.players_table_name
  players_table_arn  = local.players_table_arn
}
