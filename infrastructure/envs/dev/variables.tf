variable "env" {
  description = "Environment name"
  type        = string
  default     = "dev"
}

variable "region" {
  description = "Primary AWS region"
  type        = string
  default     = "us-east-1"
}

variable "root_domain" {
  description = "Existing Route53-hosted root/apex domain (e.g. example.com) - used to build the REST API's CORS allow-origin"
  type        = string
}

variable "subdomain" {
  description = "Frontend subdomain for this environment (e.g. dev.megadraft) - used to build the REST API's CORS allow-origin"
  type        = string
}

variable "google_client_id" {
  description = "Google OAuth client ID, used as the audience when verifying Google ID tokens (public value, safe to commit)"
  type        = string
}

variable "lambda_dist_dir" {
  description = "Path to this repo's own dist/ directory (run `pnpm build` first)"
  type        = string
  default     = "../../../dist"
}

variable "log_retention_days" {
  description = "CloudWatch Logs retention for each Lambda's log group"
  type        = number
  default     = 7
}
