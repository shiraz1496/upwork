import { readSecret, signSession, verifySession, type SessionPayload } from "@/lib/signed-session";

const COOKIE_NAME = "ut_me";
const MAX_AGE_SEC = 60 * 60 * 24 * 30;

// Separate secret from the admin cookie so one can't be forged from the other.
const secret = () => readSecret("DEV_SESSION_SECRET");

export async function buildMeCookieValue(member: {
  id: string;
  sessionVersion: number;
}): Promise<string> {
  return signSession(secret(), {
    memberId: member.id,
    role: "bidder",
    sessionVersion: member.sessionVersion,
  });
}

// Signature + expiry + role only. Routes re-check sessionVersion against the DB via resolveMeSession().
export async function verifyMeCookie(raw: string | undefined): Promise<SessionPayload | null> {
  const payload = await verifySession(secret(), raw, MAX_AGE_SEC);
  return payload?.role === "bidder" ? payload : null;
}

export const ME_COOKIE = { name: COOKIE_NAME, maxAge: MAX_AGE_SEC };
