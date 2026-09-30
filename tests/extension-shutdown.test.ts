import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakePrisma } from "./helpers/fake-prisma";

const fake = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof import("./helpers/fake-prisma").createFakePrisma> }));
vi.mock("@/lib/prisma", () => ({
  get prisma() {
    return fake.db;
  },
}));

import { NextRequest } from "next/server";
import { AuthError, resolveExtensionToken } from "@/lib/member-auth";

beforeEach(() => {
  fake.db = createFakePrisma();
});

// Every API route file, loaded on demand (the test runner cannot import a computed deep path).
type RouteModule = Record<string, (req?: NextRequest) => Promise<Response>>;
const routes = (import.meta as unknown as { glob: (p: string) => Record<string, () => Promise<RouteModule>> }).glob(
  "../app/api/**/route.ts",
);
async function loadRoute(path: string): Promise<RouteModule> {
  const load = routes[`../app/api/${path}/route.ts`];
  if (!load) throw new Error(`no route file for /api/${path}`);
  return load();
}

const GONE = { error: "deprecated", detail: "extension ingestion removed; see MCP migration" };

// Every endpoint the extension used to write to or read from (handover Phase C).
const RETIRED: [string, string][] = [
  ["sync/account", "POST"],
  ["sync/alert", "POST"],
  ["sync/contracts", "POST"],
  ["sync/freelancer-profile", "POST"],
  ["sync/proposal-detail", "POST"],
  ["sync/proposals", "POST"],
  ["auth/verify", "POST"],
  ["coverage/visit", "POST"],
  ["bidding-criteria", "GET"],
  ["blocked-titles", "GET"],
  ["freelancer-profile", "GET"],
  ["admin/team/[id]/tokens", "POST"],
  ["admin/team/tokens/[tokenId]", "DELETE"],
  // Read only by the extension; found after the Phase C list was written.
  ["nudges/pending", "GET"],
  ["nudges/ack-all", "POST"],
  ["nudges/[id]/ack", "POST"],
  ["coverage/pages", "GET"],
];

describe("extension endpoints are gone", () => {
  it.each(RETIRED)("/api/%s %s → 410", async (path, method) => {
    const mod = await loadRoute(path);
    expect(Object.keys(mod)).toEqual([method]); // nothing else is exported, so no other verb works
    const res = await mod[method]();
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual(GONE);
  });
});

describe("extension tokens are refused", () => {
  it("resolveExtensionToken never accepts a token, however it is sent", async () => {
    for (const headers of [{}, { authorization: "Bearer ut_valid_looking_token" }, { authorization: "Bearer " }] as Record<string, string>[]) {
      const p = resolveExtensionToken(new Request("http://x/api/x", { headers }));
      await expect(p).rejects.toBeInstanceOf(AuthError);
      await expect(p).rejects.toMatchObject({ reason: "extension_auth_removed" });
    }
  });
});
