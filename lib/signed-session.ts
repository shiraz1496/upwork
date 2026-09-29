// Identity-bound, HMAC-signed session cookies. Uses Web Crypto so it runs in proxy.ts and routes.
// Cookie value: base64url(JSON payload) + "." + hex HMAC-SHA256.

export type SessionPayload = {
  memberId: string;
  role: "admin" | "bidder";
  sessionVersion: number;
  iat: number; // ms since epoch
};

function toBase64Url(s: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(s)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
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

export async function signSession(
  secret: string,
  data: Omit<SessionPayload, "iat">,
): Promise<string> {
  const body = toBase64Url(JSON.stringify({ ...data, iat: Date.now() }));
  return `${body}.${await hmacHex(secret, body)}`;
}

export async function verifySession(
  secret: string,
  raw: string | undefined,
  maxAgeSec: number,
): Promise<SessionPayload | null> {
  if (!raw) return null;
  const [body, sig] = raw.split(".");
  if (!body || !sig) return null;
  if (!constantTimeEqual(sig, await hmacHex(secret, body))) return null;

  let payload: SessionPayload;
  try {
    payload = JSON.parse(fromBase64Url(body));
  } catch {
    return null;
  }
  if (
    typeof payload.memberId !== "string" ||
    (payload.role !== "admin" && payload.role !== "bidder") ||
    typeof payload.sessionVersion !== "number" ||
    typeof payload.iat !== "number"
  ) {
    return null;
  }
  const age = (Date.now() - payload.iat) / 1000;
  if (!(age >= 0 && age <= maxAgeSec)) return null;
  return payload;
}

export function readSecret(envName: string): string {
  const s = process.env[envName];
  if (!s || s.length < 16) throw new Error(`${envName} not set or too short.`);
  return s;
}
