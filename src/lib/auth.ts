import { CognitoJwtVerifier } from "aws-jwt-verify";
import { env } from "./env.js";

let verifier: ReturnType<typeof CognitoJwtVerifier.create> | null = null;

function getVerifier() {
  if (!verifier) {
    verifier = CognitoJwtVerifier.create({
      userPoolId: env.cognitoUserPoolId,
      tokenUse: "id",
      clientId: env.cognitoClientId,
    });
  }
  return verifier;
}

export interface AuthenticatedUser {
  userId: string;
  email: string | undefined;
}

/**
 * Verifies a Cognito ID token (passed as a WebSocket $connect query-string
 * param, since the WS handshake can't carry custom headers) and returns the
 * caller's identity. Throws if the token is missing/invalid/expired.
 */
export async function verifyIdToken(idToken: string | undefined): Promise<AuthenticatedUser> {
  if (!idToken) {
    throw new Error("Missing idToken");
  }

  const payload = await getVerifier().verify(idToken);

  return {
    userId: payload.sub,
    email: typeof payload.email === "string" ? payload.email : undefined,
  };
}
