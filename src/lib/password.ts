import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;

/** Hashes a draft join password as `salt:hash` (hex), independent of Cognito credentials. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hashHex] = stored.split(":");
  if (!salt || !hashHex) {
    return false;
  }

  const derived = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  const storedBuffer = Buffer.from(hashHex, "hex");

  if (derived.length !== storedBuffer.length) {
    return false;
  }

  return timingSafeEqual(derived, storedBuffer);
}
