import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ADMIN_COOKIE, buildSessionCookieValue, verifySessionCookieValue } from "@/lib/session";
import { ME_COOKIE, buildMeCookieValue, verifyMeCookie } from "@/lib/me-session";
import { signSession, verifySession } from "@/lib/signed-session";

const SECRET = "test-secret-at-least-16-chars";
const DAY = 86_400;
const data = { memberId: "m1", role: "bidder" as const, sessionVersion: 3 };

afterEach(() => vi.useRealTimers());

describe("signed session cookies", () => {
  it("binds the cookie to a member, role and sessionVersion", async () => {
    const cookie = await signSession(SECRET, data);
    const payload = await verifySession(SECRET, cookie, DAY);
    expect(payload).toMatchObject(data);
    expect(typeof payload!.iat).toBe("number");
  });

  it("rejects a cookie signed with another secret", async () => {
    const cookie = await signSession(SECRET, data);
    expect(await verifySession("a-different-secret-16ch", cookie, DAY)).toBeNull();
  });

  it("rejects a tampered payload (e.g. swapping in another member or role)", async () => {
    const cookie = await signSession(SECRET, data);
    const [, sig] = cookie.split(".");
    const forged = Buffer.from(JSON.stringify({ memberId: "someone-else", role: "admin", sessionVersion: 3, iat: Date.now() })).toString("base64url");
    expect(await verifySession(SECRET, `${forged}.${sig}`, DAY)).toBeNull();
  });

  it("rejects a tampered signature, and malformed values", async () => {
    const cookie = await signSession(SECRET, data);
    const [body, sig] = cookie.split(".");
    const flipped = (sig[0] === "0" ? "1" : "0") + sig.slice(1);
    expect(await verifySession(SECRET, `${body}.${flipped}`, DAY)).toBeNull();
    for (const bad of [undefined, "", "abc", "abc.def", `${body}.`, `.${sig}`]) {
      expect(await verifySession(SECRET, bad, DAY)).toBeNull();
    }
  });

  it("expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T00:00:00Z"));
    const cookie = await signSession(SECRET, data);
    vi.setSystemTime(new Date("2026-10-01T23:59:00Z"));
    expect(await verifySession(SECRET, cookie, DAY)).not.toBeNull();
    vi.setSystemTime(new Date("2026-10-02T00:00:01Z"));
    expect(await verifySession(SECRET, cookie, DAY)).toBeNull();
  });

  it("rejects a cookie dated in the future", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-02T00:00:00Z"));
    const cookie = await signSession(SECRET, data);
    vi.setSystemTime(new Date("2026-10-01T00:00:00Z"));
    expect(await verifySession(SECRET, cookie, DAY)).toBeNull();
  });
});

describe("a correctly signed cookie with the wrong contents", () => {
  // Signed with the real secret, so only the payload checks can reject these.
  const signed = (payload: unknown) => {
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `${body}.${createHmac("sha256", SECRET).update(body).digest("hex")}`;
  };
  const good = { memberId: "m1", role: "bidder", sessionVersion: 0, iat: Date.now() };

  it("accepts the well-formed one (so the rejections below are about the payload)", async () => {
    expect(await verifySession(SECRET, signed(good), DAY)).toMatchObject({ memberId: "m1" });
  });

  it.each([
    ["unknown role", { ...good, role: "superuser" }],
    ["sessionVersion as text", { ...good, sessionVersion: "0" }],
    ["missing sessionVersion", { memberId: "m1", role: "bidder", iat: Date.now() }],
    ["memberId not text", { ...good, memberId: 42 }],
    ["missing iat", { memberId: "m1", role: "bidder", sessionVersion: 0 }],
    ["iat as text", { ...good, iat: String(Date.now()) }],
    ["not an object", "just a string"],
    ["null", null],
  ])("rejects: %s", async (_name, payload) => {
    expect(await verifySession(SECRET, signed(payload), DAY)).toBeNull();
  });

  it("rejects a body that is not JSON", async () => {
    const body = Buffer.from("not json").toString("base64url");
    expect(await verifySession(SECRET, `${body}.${createHmac("sha256", SECRET).update(body).digest("hex")}`, DAY)).toBeNull();
  });
});

describe("admin vs developer separation", () => {
  const member = { id: "m1", sessionVersion: 0 };

  it("uses different cookie names", () => {
    expect(ADMIN_COOKIE.name).not.toBe(ME_COOKIE.name);
  });

  it("a developer cookie is not an admin cookie, and the reverse (separate secrets)", async () => {
    vi.stubEnv("ADMIN_SESSION_SECRET", "admin-secret-16-chars-min");
    vi.stubEnv("DEV_SESSION_SECRET", "developer-secret-16-chars");
    const admin = await buildSessionCookieValue(member);
    const dev = await buildMeCookieValue(member);
    expect(await verifySessionCookieValue(admin)).toMatchObject({ memberId: "m1", role: "admin" });
    expect(await verifyMeCookie(dev)).toMatchObject({ memberId: "m1", role: "bidder" });
    expect(await verifySessionCookieValue(dev)).toBeNull();
    expect(await verifyMeCookie(admin)).toBeNull();
  });

  it("even if both secrets were the same, the role in the cookie keeps them apart", async () => {
    vi.stubEnv("ADMIN_SESSION_SECRET", "same-secret-16-chars-min");
    vi.stubEnv("DEV_SESSION_SECRET", "same-secret-16-chars-min");
    const admin = await buildSessionCookieValue(member);
    const dev = await buildMeCookieValue(member);
    expect(await verifySessionCookieValue(dev)).toBeNull();
    expect(await verifyMeCookie(admin)).toBeNull();
  });

  it("refuses to run with a missing or short secret", async () => {
    vi.stubEnv("DEV_SESSION_SECRET", "short");
    await expect(buildMeCookieValue(member)).rejects.toThrow(/DEV_SESSION_SECRET/);
  });
});
