import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakePrisma } from "../helpers/fake-prisma";

const fake = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof import("../helpers/fake-prisma").createFakePrisma>,
  jar: {} as Record<string, string>,
}));
vi.mock("@/lib/prisma", () => ({
  get prisma() {
    return fake.db;
  },
}));
// The request's cookie jar.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name in fake.jar ? { value: fake.jar[name] } : undefined) }),
}));

import { AdminAuthError, adminErrorResponse, requireAdmin } from "@/lib/admin-auth";
import { assertOwns, authErrorResponse, requireDeveloper, resolveMeSession } from "@/lib/me-auth";
import { AuthError, ForbiddenError } from "@/lib/member-auth";
import { ME_COOKIE, buildMeCookieValue } from "@/lib/me-session";
import { ADMIN_COOKIE, buildSessionCookieValue } from "@/lib/session";

const admin = { id: "a1", name: "Admin", email: "admin@x.test", role: "admin", status: "active", sessionVersion: 0, passwordHash: "salt:hash" };
const bidder = { id: "b1", name: "Bidder", email: "bidder@x.test", role: "bidder", status: "active", sessionVersion: 0, passwordHash: "salt:hash" };

beforeEach(() => {
  fake.db = createFakePrisma();
  fake.jar = {};
  fake.db._members.set(admin.id, { ...admin });
  fake.db._members.set(bidder.id, { ...bidder });
  vi.stubEnv("ADMIN_SESSION_SECRET", "admin-secret-16-chars-min");
  vi.stubEnv("DEV_SESSION_SECRET", "developer-secret-16-chars");
});

const asAdmin = async (m = admin) => (fake.jar[ADMIN_COOKIE.name] = await buildSessionCookieValue(m));
const asBidder = async (m = bidder) => (fake.jar[ME_COOKIE.name] = await buildMeCookieValue(m));

describe("requireAdmin", () => {
  it("returns the admin the cookie identifies — and never the password hash", async () => {
    await asAdmin();
    const me = await requireAdmin();
    expect(me).toMatchObject({ id: "a1", role: "admin" });
    expect(me).not.toHaveProperty("passwordHash");
  });

  it("identifies the right admin when there are several (not 'the oldest admin')", async () => {
    fake.db._members.set("a2", { ...admin, id: "a2", name: "Second Admin" });
    await asAdmin({ ...admin, id: "a2" });
    expect((await requireAdmin()).id).toBe("a2");
  });

  it("rejects: no cookie", async () => {
    await expect(requireAdmin()).rejects.toBeInstanceOf(AdminAuthError);
  });

  it("rejects once sessionVersion was bumped (password / role / status change)", async () => {
    await asAdmin();
    fake.db._members.get("a1")!.sessionVersion = 1;
    await expect(requireAdmin()).rejects.toBeInstanceOf(AdminAuthError);
  });

  it("rejects an admin who was demoted, deactivated or deleted", async () => {
    await asAdmin();
    fake.db._members.get("a1")!.role = "bidder";
    await expect(requireAdmin()).rejects.toBeInstanceOf(AdminAuthError);

    fake.db._members.get("a1")!.role = "admin";
    fake.db._members.get("a1")!.status = "inactive";
    await expect(requireAdmin()).rejects.toBeInstanceOf(AdminAuthError);

    fake.db._members.delete("a1");
    await expect(requireAdmin()).rejects.toBeInstanceOf(AdminAuthError);
  });

  it("rejects a developer's cookie placed in the admin cookie", async () => {
    fake.jar[ADMIN_COOKIE.name] = await buildMeCookieValue(bidder);
    await expect(requireAdmin()).rejects.toBeInstanceOf(AdminAuthError);
  });

  it("maps to 401 without details", async () => {
    const res = adminErrorResponse(new AdminAuthError("unauthenticated"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });
});

describe("developer session", () => {
  it("resolves the developer from the cookie", async () => {
    await asBidder();
    const { member } = await resolveMeSession();
    expect(member).toMatchObject({ id: "b1", role: "bidder" });
    expect(member).not.toHaveProperty("passwordHash");
    expect((await requireDeveloper()).id).toBe("b1");
  });

  it("ignores a Bearer header — the extension-token path is gone", async () => {
    const req = new Request("http://x/api/me/notes", { headers: { authorization: "Bearer ut_anything" } });
    await expect(resolveMeSession(req)).rejects.toMatchObject({ reason: "unauthenticated" });
  });

  it("rejects once sessionVersion was bumped", async () => {
    await asBidder();
    fake.db._members.get("b1")!.sessionVersion = 5;
    await expect(resolveMeSession()).rejects.toMatchObject({ reason: "session_expired" });
  });

  it("rejects a deactivated or deleted developer", async () => {
    await asBidder();
    fake.db._members.get("b1")!.status = "inactive";
    await expect(resolveMeSession()).rejects.toMatchObject({ reason: "member_inactive" });
    fake.db._members.delete("b1");
    await expect(resolveMeSession()).rejects.toBeInstanceOf(AuthError);
  });

  it("rejects a developer who became an admin (must use the admin login)", async () => {
    await asBidder();
    fake.db._members.get("b1")!.role = "admin";
    await expect(resolveMeSession()).rejects.toMatchObject({ reason: "session_expired" });
  });

  it("rejects an admin cookie placed in the developer cookie", async () => {
    fake.jar[ME_COOKIE.name] = await buildSessionCookieValue(admin);
    await expect(resolveMeSession()).rejects.toBeInstanceOf(AuthError);
  });
});

describe("ownership guard", () => {
  it("allows the owner and refuses everyone else", () => {
    expect(() => assertOwns({ id: "b1" }, "b1")).not.toThrow();
    expect(() => assertOwns({ id: "b1" }, "b2")).toThrow(ForbiddenError);
    expect(() => assertOwns({ id: "b1" }, null)).toThrow(ForbiddenError);
    expect(() => assertOwns({ id: "b1" }, undefined)).toThrow(ForbiddenError);
  });

  it("forbidden → 403, auth failure → 401", async () => {
    expect(authErrorResponse(new ForbiddenError()).status).toBe(403);
    const res = authErrorResponse(new AuthError("session_expired"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "session_expired" });
  });
});

describe("logout", () => {
  it("signs the member out on the server, so a copied cookie stops working", async () => {
    await asAdmin();
    const copied = fake.jar[ADMIN_COOKIE.name];
    const { POST } = await import("@/app/api/admin/logout/route");
    const res = await POST();
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(/ut_admin=;.*Max-Age=0/i);
    expect(fake.db._members.get("a1")!.sessionVersion).toBe(1);
    fake.jar[ADMIN_COOKIE.name] = copied; // someone still holding the old cookie
    await expect(requireAdmin()).rejects.toBeInstanceOf(AdminAuthError);
  });

  it("does the same for a bidder", async () => {
    await asBidder();
    const copied = fake.jar[ME_COOKIE.name];
    const { POST } = await import("@/app/api/me/logout/route");
    await POST();
    expect(fake.db._members.get("b1")!.sessionVersion).toBe(1);
    fake.jar[ME_COOKIE.name] = copied;
    await expect(resolveMeSession()).rejects.toMatchObject({ reason: "session_expired" });
  });

  it("with no cookie, or a forged one, it changes nobody's session", async () => {
    const { POST } = await import("@/app/api/me/logout/route");
    expect((await POST()).status).toBe(200);
    fake.jar[ME_COOKIE.name] = "forged.value";
    await POST();
    // An admin cookie sent to the bidder logout must not sign the admin out either.
    fake.jar[ME_COOKIE.name] = await buildSessionCookieValue(admin);
    await POST();
    expect(fake.db._members.get("a1")!.sessionVersion).toBe(0);
    expect(fake.db._members.get("b1")!.sessionVersion).toBe(0);
  });

  it("an old cookie cannot sign out a newer session", async () => {
    await asBidder();
    fake.db._members.get("b1")!.sessionVersion = 3; // member has since logged in again elsewhere
    const { POST } = await import("@/app/api/me/logout/route");
    await POST();
    expect(fake.db._members.get("b1")!.sessionVersion).toBe(3);
  });
});

describe("the real database client hides password hashes", () => {
  it("lib/prisma.ts omits TeamMember.passwordHash for every query by default", async () => {
    // The fake database used in these tests copies this behaviour, so check the real config.
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("../../lib/prisma.ts", import.meta.url), "utf8");
    expect(source).toMatch(/new PrismaClient\(\{[\s\S]*omit:\s*\{\s*teamMember:\s*\{\s*passwordHash:\s*true\s*\}\s*\}/);
  });

  it("only the login check opts back in", async () => {
    const { execSync } = await import("node:child_process");
    const root = new URL("../../", import.meta.url).pathname;
    const hits = execSync(`grep -rlnE "omit: *\\{ *passwordHash: *false" app components proxy.ts lib --exclude=prisma.ts || true`, { cwd: root, encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
    expect(hits).toEqual(["lib/login.ts"]);
  });
});
