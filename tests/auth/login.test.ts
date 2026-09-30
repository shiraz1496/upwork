import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakePrisma } from "../helpers/fake-prisma";

const fake = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof import("../helpers/fake-prisma").createFakePrisma> }));
vi.mock("@/lib/prisma", () => ({
  get prisma() {
    return fake.db;
  },
}));

// Keep the real crypto, but count how often the "spend the same time" check runs.
const burn = vi.hoisted(() => ({ calls: 0 }));
vi.mock("@/lib/crypto", async (original) => {
  const real = await original<typeof import("@/lib/crypto")>();
  return {
    ...real,
    burnPasswordCheck: (pw: string) => {
      burn.calls++;
      return real.burnPasswordCheck(pw);
    },
  };
});

import { hashPassword } from "@/lib/crypto";
import { LoginBody, authenticateMember } from "@/lib/login";

const PASSWORD = "correct horse battery";

beforeEach(() => {
  fake.db = createFakePrisma();
  fake.db._members.set("a1", { id: "a1", name: "Admin", email: "Admin@X.test", role: "admin", status: "active", sessionVersion: 0, lastLoginAt: null, passwordHash: hashPassword(PASSWORD) });
  fake.db._members.set("b1", { id: "b1", name: "Bidder", email: "bidder@x.test", role: "bidder", status: "active", sessionVersion: 0, lastLoginAt: null, passwordHash: hashPassword(PASSWORD) });
  fake.db._members.set("n1", { id: "n1", name: "No Password", email: "new@x.test", role: "bidder", status: "active", sessionVersion: 0, passwordHash: null });
});

describe("authenticateMember", () => {
  it("logs in with the right email, password and role — without returning the hash", async () => {
    const m = await authenticateMember("bidder@x.test", PASSWORD, "bidder");
    expect(m).toMatchObject({ id: "b1", role: "bidder" });
    expect(m).not.toHaveProperty("passwordHash");
    expect(fake.db._members.get("b1")!.lastLoginAt).toBeInstanceOf(Date);
  });

  it("matches the email regardless of letter case", async () => {
    expect(await authenticateMember("admin@x.test", PASSWORD, "admin")).toMatchObject({ id: "a1" });
  });

  it("returns null — with no hint why — for every kind of failure", async () => {
    expect(await authenticateMember("bidder@x.test", "wrong password", "bidder")).toBeNull();
    expect(await authenticateMember("nobody@x.test", PASSWORD, "bidder")).toBeNull();
    expect(await authenticateMember("new@x.test", PASSWORD, "bidder")).toBeNull(); // no password set yet
    expect(await authenticateMember("new@x.test", "", "bidder")).toBeNull();
  });

  it("spends a password check even when there is nothing to check (unknown email / no password set)", async () => {
    burn.calls = 0;
    await authenticateMember("nobody@x.test", PASSWORD, "bidder");
    expect(burn.calls).toBe(1);
    await authenticateMember("new@x.test", PASSWORD, "bidder");
    expect(burn.calls).toBe(2);
    // A real account does its own check, so no extra one is needed.
    await authenticateMember("bidder@x.test", "wrong password", "bidder");
    expect(burn.calls).toBe(2);
  });

  it("a bidder cannot log in on the admin side, nor an admin on the bidder side", async () => {
    expect(await authenticateMember("bidder@x.test", PASSWORD, "admin")).toBeNull();
    expect(await authenticateMember("admin@x.test", PASSWORD, "bidder")).toBeNull();
    expect(fake.db._members.get("b1")!.lastLoginAt).toBeNull();
  });

  it("a deactivated member cannot log in", async () => {
    fake.db._members.get("b1")!.status = "inactive";
    expect(await authenticateMember("bidder@x.test", PASSWORD, "bidder")).toBeNull();
  });
});

describe("LoginBody", () => {
  it("normalises the email and requires both fields", () => {
    expect(LoginBody.parse({ email: "  Bidder@X.test ", password: "p" })).toEqual({ email: "bidder@x.test", password: "p" });
    expect(() => LoginBody.parse({ password: "p" })).toThrow();
    expect(() => LoginBody.parse({ email: "not-an-email", password: "p" })).toThrow();
    expect(() => LoginBody.parse({ email: "a@b.test", password: "" })).toThrow();
    // The old bodies no longer work.
    expect(() => LoginBody.parse({ token: "ut_abc" })).toThrow();
  });
});
