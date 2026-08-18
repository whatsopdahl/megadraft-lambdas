function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  get connectionsTable() {
    return required("CONNECTIONS_TABLE");
  },
  get draftsTable() {
    return required("DRAFTS_TABLE");
  },
  get playersTable() {
    return required("PLAYERS_TABLE");
  },
  get draftPicksTable() {
    return required("DRAFT_PICKS_TABLE");
  },
  get cognitoUserPoolId() {
    return required("COGNITO_USER_POOL_ID");
  },
  get cognitoClientId() {
    return required("COGNITO_CLIENT_ID");
  },
  get webSocketManagementEndpoint() {
    return required("WEBSOCKET_MANAGEMENT_ENDPOINT");
  },
  get schedulerRoleArn() {
    return required("SCHEDULER_ROLE_ARN");
  },
  get pickTimeoutFunctionArn() {
    return required("PICK_TIMEOUT_FUNCTION_ARN");
  },
};
