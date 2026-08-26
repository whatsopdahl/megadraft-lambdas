output "rest_api_endpoint" {
  value = module.rest_api.rest_api_endpoint
}

output "websocket_endpoint" {
  value = module.websocket_api.websocket_endpoint
}

output "player_sync_function_name" {
  value = module.player_sync.function_name
}

output "espn_credentials_secret_name" {
  value = module.player_sync.secret_name
}
