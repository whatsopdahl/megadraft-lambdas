terraform {
  required_providers {
    aws     = { source = "hashicorp/aws" }
    archive = { source = "hashicorp/archive" }
  }
}

# Manually invoked (`aws lambda invoke`) - no schedule, no API Gateway route.
# Pulls free-agent rankings/injury status from ESPN's fantasy API and
# upserts them into the shared Players table. See README for how to invoke
# it and how to populate the secret below.

# The secret's VALUE is intentionally not managed here (no
# aws_secretsmanager_secret_version resource) so espn_s2/SWID never touch
# Terraform state or this repo - set it once via the AWS CLI/console (see
# README).
#
# Named "...-v2-..." rather than "...-espn-credentials-<env>" because the
# first attempt at this name got force-deleted during initial setup and hit
# AWS's Secrets Manager tombstone-replication lag (CreateSecret kept
# rejecting with "already scheduled for deletion" well after DescribeSecret
# showed it gone) - picking a fresh name sidesteps that entirely rather than
# waiting on AWS-side propagation with no ETA.
resource "aws_secretsmanager_secret" "espn_credentials" {
  name        = "fantasy-draft/espn-credentials-v2-${var.env}"
  description = "ESPN fantasy cookies (espn_s2, SWID) and league IDs/years used by syncEspnPlayers"
}

resource "aws_iam_role" "lambda_exec" {
  name = "fantasy-draft-player-sync-lambda-exec-${var.env}"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_basic" {
  role       = aws_iam_role.lambda_exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "lambda_app" {
  name = "fantasy-draft-player-sync-lambda-app-${var.env}"
  role = aws_iam_role.lambda_exec.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["dynamodb:PutItem", "dynamodb:BatchWriteItem"]
        Resource = var.players_table_arn
      },
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = aws_secretsmanager_secret.espn_credentials.arn
      },
    ]
  })
}

resource "aws_cloudwatch_log_group" "handler" {
  name              = "/aws/lambda/fantasy-draft-syncEspnPlayers-${var.env}"
  retention_in_days = var.log_retention_days
}

data "archive_file" "handler" {
  type        = "zip"
  source_file = "${var.lambda_dist_dir}/syncEspnPlayers.mjs"
  output_path = "${path.module}/.build/syncEspnPlayers.zip"
}

resource "aws_lambda_function" "handler" {
  function_name    = "fantasy-draft-syncEspnPlayers-${var.env}"
  role             = aws_iam_role.lambda_exec.arn
  runtime          = "nodejs24.x"
  handler          = "syncEspnPlayers.handler"
  filename         = data.archive_file.handler.output_path
  source_code_hash = data.archive_file.handler.output_base64sha256
  # ESPN's free-agent endpoint is called once per NFL position group plus
  # once for all NBA players (~9 HTTP calls, NFL mostly sequential/NBA in
  # parallel). espnGet() retries on 429/5xx with exponential backoff, so a
  # throttled run can legitimately take minutes rather than seconds - 600s
  # comfortably covers worst-case backoff across every call (Lambda's hard
  # ceiling is 900s if more headroom is ever needed).
  timeout     = 600
  memory_size = 256
  # reserved_concurrent_executions = 1 (only one sync should ever be in
  # flight against ESPN at a time) is deliberately omitted for now - this
  # account's Lambda concurrency quota is stuck at AWS's 10-execution
  # minimum, and reserving even 1 here would push unreserved below that
  # floor (AccountLimit.UnreservedConcurrentExecutions must stay >= 10).
  # A quota increase to 1000 is pending (Service Quotas request
  # dbd1cda185f3424594fc2fbf31817ab5altXn6IR, service code lambda, quota
  # L-B99A9384) - once it clears, add this back:
  #   reserved_concurrent_executions = 1


  environment {
    variables = {
      PLAYERS_TABLE               = var.players_table_name
      ESPN_CREDENTIALS_SECRET_ARN = aws_secretsmanager_secret.espn_credentials.arn
    }
  }

  depends_on = [aws_cloudwatch_log_group.handler]
}
