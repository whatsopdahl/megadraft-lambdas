import { APIGatewayProxyWebsocketHandlerV2 } from "aws-lambda";
import { removeConnection } from "../lib/connection.js";

export const handler: APIGatewayProxyWebsocketHandlerV2 = async (event) => {
  try {
    const connectionId = event.requestContext.connectionId;
    await removeConnection(connectionId);

    return { statusCode: 200, body: "Disconnected" };
  } catch (error) {
    console.error("Disconnect error:", error);
    return { statusCode: 200, body: "" };
  }
};
