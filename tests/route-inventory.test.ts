import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakePrisma } from "./helpers/fake-prisma";

const fake = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof import("./helpers/fake-prisma").createFakePrisma> }));
vi.mock("@/lib/prisma", () => ({
  get prisma() {
    return fake.db;
  },
}));
// No cookies at all: every request below is anonymous.
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

import { NextRequest } from "next/server";

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const routes = (import.meta as unknown as { glob: (p: string) => Record<string, () => Promise<Record<string, Handler>>> }).glob(
  "../app/api/**/route.ts",
);
const pathOf = (file: string) => file.replace("../app/api/", "").replace("/route.ts", "");

// Routes that are meant to answer without a login, and what they answer.
const PUBLIC: Record<string, number> = {
  "admin/login POST": 400, // reachable; an empty body is rejected as invalid
  "me/login POST": 400,
  "admin/logout POST": 200, // only clears the caller's own cookie
  "me/logout POST": 200,
  "me/upwork/callback GET": 307, // browser redirect to the login page
  "analyze/cover-letter POST": 403, // switched off before anything else
};
const RETIRED = new Set([
  "sync/account", "sync/alert", "sync/contracts", "sync/freelancer-profile", "sync/proposal-detail", "sync/proposals",
  "auth/verify", "coverage/visit", "bidding-criteria", "blocked-titles", "freelancer-profile",
  "admin/team/[id]/tokens", "admin/team/tokens/[tokenId]",
  "nudges/pending", "nudges/ack-all", "nudges/[id]/ack", "coverage/pages",
]);

beforeEach(() => {
  fake.db = createFakePrisma();
  vi.stubEnv("ADMIN_SESSION_SECRET", "admin-secret-16-chars-min");
  vi.stubEnv("DEV_SESSION_SECRET", "developer-secret-16-chars");
  vi.stubEnv("UPWORK_MCP_ENABLED", "false");
  vi.stubEnv("UPWORK_MCP_MOCK", "");
  vi.stubEnv("AI_SCORING_ENABLED", "false");
});

describe("every API route, called with no login", () => {
  const files = Object.keys(routes).sort();

  it("finds the route files", () => {
    expect(files.length).toBeGreaterThan(55);
  });

  it.each(files.map((f) => [pathOf(f), f]))("/api/%s", async (path, file) => {
    const mod = await routes[file]();
    const methods = Object.keys(mod).filter((k) => ["GET", "POST", "PATCH", "PUT", "DELETE"].includes(k));
    expect(methods.length).toBeGreaterThan(0);

    for (const method of methods) {
      const req = new NextRequest(`http://localhost/api/${path.replace(/\[(\w+)\]/g, "x")}`, {
        method,
        ...(method !== "GET" && { body: "{}", headers: { "content-type": "application/json" } }),
      });
      const res = await mod[method](req, { params: Promise.resolve({ id: "x", keywordId: "x", tokenId: "x" }) });
      const key = `${path} ${method}`;
      const expected = key in PUBLIC ? PUBLIC[key] : RETIRED.has(path) ? 410 : 401;
      expect(res.status, `${method} /api/${path}`).toBe(expected);
      // An anonymous caller must never receive data.
      if (expected === 401) expect(Object.keys(await res.json())).toEqual(["error"]);
    }
  });

  it("the list of public routes is exact (a new public route must be added here on purpose)", () => {
    const known = new Set(files.map(pathOf));
    for (const key of Object.keys(PUBLIC)) expect(known.has(key.split(" ")[0]), key).toBe(true);
    for (const path of RETIRED) expect(known.has(path), path).toBe(true);
  });
});
