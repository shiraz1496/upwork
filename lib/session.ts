import { readSecret, signSession, verifySession, type SessionPayload } from "@/lib/signed-session";

const COOKIE_NAME = "ut_admin";
const MAX_AGE_SEC = 60 * 60 * 24 * 30;

const secret = () => readSecret("ADMIN_SESSION_SECRET");

export async function buildSessionCookieValue(member: {
  id: string;
  sessionVersion: number;
}): Promise<string> {
  return signSession(secret(), {
    memberId: member.id,
    role: "admin",
    sessionVersion: member.sessionVersion,
  });
}

// Signature + expiry + role only. Routes re-check sessionVersion against the DB via requireAdmin().
export async function verifySessionCookieValue(
  raw: string | undefined,
): Promise<SessionPayload | null> {
  const payload = await verifySession(secret(), raw, MAX_AGE_SEC);
  return payload?.role === "admin" ? payload : null;
}

export const ADMIN_COOKIE = { name: COOKIE_NAME, maxAge: MAX_AGE_SEC };
