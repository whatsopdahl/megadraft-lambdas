import { JwtRsaVerifier } from "aws-jwt-verify";
import { env } from "./env.js";

let verifier: ReturnType<typeof JwtRsaVerifier.create> | null = null;

function getVerifier() {
  if (!verifier) {
    verifier = JwtRsaVerifier.create({
      issuer: "https://accounts.google.com",
      audience: env.googleClientId,
      jwksUri: "https://www.googleapis.com/oauth2/v3/certs",
    });
  }
  return verifier;
}

export interface AuthenticatedUser {
  userId: string;
  email: string | undefined;
}

/**
 * Verifies a Google ID token (passed as a WebSocket $connect query-string
 * param, since the WS handshake can't carry custom headers) and returns the
 * caller's identity. Throws if the token is missing/invalid/expired.
 */
export async function verifyIdToken(idToken: string | undefined): Promise<AuthenticatedUser> {
  if (!idToken) {
    throw new Error("Missing idToken");
  }

  const payload = await getVerifier().verify(idToken);

  if (!payload.sub) {
    throw new Error("ID token missing sub claim");
  }

  return {
    userId: payload.sub,
    email: typeof payload.email === "string" ? payload.email : undefined,
  };
}
