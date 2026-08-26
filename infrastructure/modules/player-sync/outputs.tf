output "function_name" {
  value = aws_lambda_function.handler.function_name
}

output "secret_arn" {
  value = aws_secretsmanager_secret.espn_credentials.arn
}

output "secret_name" {
  value = aws_secretsmanager_secret.espn_credentials.name
}
