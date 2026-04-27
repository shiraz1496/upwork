const COOKIE_NAME = "ut_me";
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

export async function buildMeCookieValue(memberId: string): Promise<string> {
  const issuedAt = Date.now().toString();
  const sig = await hmacHex(`${memberId}.${issuedAt}`);
  return `${memberId}.${issuedAt}.${sig}`;
}

export async function verifyMeCookie(
  raw: string | undefined,
): Promise<{ memberId: string } | null> {
  if (!raw) return null;
  const parts = raw.split(".");
  if (parts.length !== 3) return null;
  const [memberId, issuedAt, sig] = parts;
  if (!memberId || !issuedAt || !sig) return null;

  const expected = await hmacHex(`${memberId}.${issuedAt}`);
  if (!constantTimeEqual(sig, expected)) return null;

  const age = (Date.now() - Number(issuedAt)) / 1000;
  if (!(age >= 0 && age <= MAX_AGE_SEC)) return null;

  return { memberId };
}

export const ME_COOKIE = { name: COOKIE_NAME, maxAge: MAX_AGE_SEC };
