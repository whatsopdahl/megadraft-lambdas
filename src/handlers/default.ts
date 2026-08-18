import { APIGatewayProxyWebsocketHandlerV2 } from "aws-lambda";
import { sendToConnection } from "../lib/broadcast.js";

export const handler: APIGatewayProxyWebsocketHandlerV2 = async (event) => {
  try {
    const connectionId = event.requestContext.connectionId;
    await sendToConnection(connectionId, { type: "error", message: "Unknown action" });

    return { statusCode: 200, body: "" };
  } catch (error) {
    console.error("Default handler error:", error);
    return { statusCode: 200, body: "" };
  }
};
