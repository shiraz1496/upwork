const COOKIE_NAME = "ut_admin";
const MAX_AGE_SEC = 60 * 60 * 24 * 30;

function secret(): string {
  const s = process.env.ADMIN_SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("ADMIN_SESSION_SECRET not set or too short.");
  return s;
}

async function hmacHex(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function buildSessionCookieValue(): Promise<string> {
  const issuedAt = Date.now().toString();
  const sig = await hmacHex(issuedAt);
  return `${issuedAt}.${sig}`;
}

export async function verifySessionCookieValue(raw: string | undefined): Promise<boolean> {
  if (!raw) return false;
  const [issuedAt, sig] = raw.split(".");
  if (!issuedAt || !sig) return false;
  const expected = await hmacHex(issuedAt);
  if (!constantTimeEqual(sig, expected)) return false;
  const age = (Date.now() - Number(issuedAt)) / 1000;
  return age >= 0 && age <= MAX_AGE_SEC;
}

export const ADMIN_COOKIE = { name: COOKIE_NAME, maxAge: MAX_AGE_SEC };
