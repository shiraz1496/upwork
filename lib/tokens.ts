import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const TOKEN_BYTES = 32;
const TOKEN_PREFIX = "ut_";

function pepper(): string {
  const p = process.env.TOKEN_HASH_PEPPER;
  if (!p || p.length < 16) {
    throw new Error("TOKEN_HASH_PEPPER is not set or too short (need ≥16 chars).");
  }
  return p;
}

export function generateToken(): string {
  const random = randomBytes(TOKEN_BYTES).toString("base64url");
  return `${TOKEN_PREFIX}${random}`;
}

export function hashToken(raw: string): string {
  return createHmac("sha256", pepper()).update(raw).digest("hex");
}

export function verifyToken(raw: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashToken(raw), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
