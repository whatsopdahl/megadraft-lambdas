import { APIGatewayProxyWebsocketHandlerV2 } from "aws-lambda";
import { verifyIdToken } from "../lib/auth.js";
import { createConnection } from "../lib/connection.js";

export const handler: APIGatewayProxyWebsocketHandlerV2 = async (event) => {
  try {
    const connectionId = event.requestContext.connectionId;
    const idToken = event.queryStringParameters?.idToken;

    const user = await verifyIdToken(idToken);
    await createConnection(connectionId, user.userId);

    return { statusCode: 200, body: "Connected" };
  } catch (error) {
    console.error("Connect error:", error);
    return { statusCode: 401, body: "Unauthorized" };
  }
};
