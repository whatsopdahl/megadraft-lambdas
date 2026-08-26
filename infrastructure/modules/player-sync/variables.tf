variable "env" {
  type = string
}

variable "lambda_dist_dir" {
  description = "Path to the lambda repo's dist/ directory containing built .mjs handlers"
  type        = string
}

variable "log_retention_days" {
  type    = number
  default = 7
}

variable "players_table_name" { type = string }
variable "players_table_arn" { type = string }
