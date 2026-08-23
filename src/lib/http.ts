import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { verifyIdToken, type AuthenticatedUser } from "./auth.js";
import type { Draft } from "./types.js";

/** Verifies the caller's Google ID token from the `Authorization: Bearer <idToken>` header. */
export async function requireAuth(event: APIGatewayProxyEventV2): Promise<AuthenticatedUser> {
  const header = event.headers?.authorization ?? event.headers?.Authorization;
  const idToken = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
  return verifyIdToken(idToken);
}

export function jsonResponse(statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

/** Strips the password hash before a draft is ever sent back over REST. */
export function sanitizeDraft(draft: Draft): Omit<Draft, "draftPasswordHash"> {
  const { draftPasswordHash: _draftPasswordHash, ...rest } = draft;
  return rest;
}
