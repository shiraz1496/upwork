import { describe, expect, it } from "vitest";
import { MCP_DATA_TTL_DAYS, mcpDataExpiry } from "@/lib/retention";
import { MCP_DATA_TTL_DAYS as SCRIPT_TTL_DAYS, purgeExpired } from "../scripts/purge-expired.mjs";

type Call = { model: string; method: string; args: Record<string, unknown> };

// Records every Prisma call the script makes and answers the reads with fixed numbers.
function stubPrisma(staleProfiles = [{ id: "p1", accountId: "a1" }]) {
  const calls: Call[] = [];
  const model = (name: string, extra: Record<string, unknown> = {}) =>
    new Proxy(extra, {
      get(target, method: string) {
        if (method in target) return target[method];
        return (args: Record<string, unknown>) => {
          calls.push({ model: name, method, args });
          return method === "count" ? 3 : { count: 0 };
        };
      },
    });
  const prisma = {
    clientResponse: model("clientResponse"),
    proposalDraft: model("proposalDraft"),
    account: model("account"),
    upworkConnection: model("upworkConnection", {
      findMany: async (args: Record<string, unknown>) => {
        calls.push({ model: "upworkConnection", method: "findMany", args });
        return [{ upworkAccountId: "org1" }, { upworkAccountId: "org2" }];
      },
    }),
    freelancerProfile: model("freelancerProfile", {
      findMany: async (args: Record<string, unknown>) => {
        calls.push({ model: "freelancerProfile", method: "findMany", args });
        return staleProfiles;
      },
    }),
    $transaction: async (ops: unknown[]) => Promise.all(ops),
  };
  // The script only uses the handful of calls stubbed above.
  return { prisma: prisma as unknown as Parameters<typeof purgeExpired>[0], calls };
}

const writes = (calls: Call[]) => calls.filter((c) => ["updateMany", "deleteMany", "update", "delete", "create"].includes(c.method));
const NOW = new Date("2026-10-31T12:00:00.000Z");

describe("retention settings", () => {
  it("the purge script and the app use the same retention period", () => {
    expect(SCRIPT_TTL_DAYS).toBe(MCP_DATA_TTL_DAYS);
  });
  it("mcpDataExpiry is that many days ahead", () => {
    const from = new Date("2026-10-01T00:00:00.000Z");
    expect(mcpDataExpiry(from).getTime() - from.getTime()).toBe(MCP_DATA_TTL_DAYS * 86_400_000);
  });
});

describe("purgeExpired", () => {
  it("dry run counts but writes nothing", async () => {
    const { prisma, calls } = stubPrisma();
    const r = await purgeExpired(prisma, { dryRun: true, now: NOW });
    expect(r).toEqual({ dryRun: true, replySnippets: 3, jobDescriptionCaches: 3, upworkProfiles: 1, abandonedSignIns: 3 });
    expect(writes(calls)).toEqual([]);
  });

  it("only selects data that is actually past its expiry", async () => {
    const { prisma, calls } = stubPrisma();
    await purgeExpired(prisma, { now: NOW });
    const find = (model: string, method: string) => calls.find((c) => c.model === model && c.method === method)!.args;

    expect(find("clientResponse", "updateMany")).toEqual({
      where: { snippet: { not: null }, expiresAt: { lte: NOW } },
      data: { snippet: null },
    });
    expect(find("proposalDraft", "updateMany")).toEqual({
      where: { jobDescriptionCache: { not: null }, jobDataExpiresAt: { lte: NOW } },
      data: { jobDescriptionCache: null },
    });
    // Profiles: older than the retention period AND belonging to an Upwork connection.
    expect(find("freelancerProfile", "findMany").where).toEqual({
      capturedAt: { lt: new Date("2026-10-01T12:00:00.000Z") },
      account: { freelancerId: { in: ["org1", "org2"] } },
    });
    expect(find("freelancerProfile", "deleteMany")).toEqual({ where: { id: { in: ["p1"] } } });
    expect(find("account", "updateMany")).toEqual({ where: { id: { in: ["a1"] } }, data: { connectsBalance: null } });
    // Sign-in state: only when older than an hour.
    expect(find("upworkConnection", "updateMany")).toEqual({
      where: { oauthState: { not: null }, updatedAt: { lt: new Date("2026-10-31T11:00:00.000Z") } },
      data: { oauthState: null, oauthCodeVerifier: null },
    });
  });

  it("never writes to the team's own content", async () => {
    const { prisma, calls } = stubPrisma();
    await purgeExpired(prisma, { now: NOW });
    // The only fields it sets, across every write:
    const touched = new Set(writes(calls).flatMap((c) => Object.keys((c.args.data as object) ?? {})));
    expect([...touched].sort()).toEqual(["connectsBalance", "jobDescriptionCache", "oauthCodeVerifier", "oauthState", "snippet"]);
    // and the only tables it deletes from:
    expect(calls.filter((c) => c.method === "deleteMany").map((c) => c.model)).toEqual(["freelancerProfile"]);
    // It never touches these at all:
    const models = new Set(calls.map((c) => c.model));
    for (const m of ["proposal", "alert", "coachingNote", "proposalStatusEvent", "teamMember"]) expect(models.has(m)).toBe(false);
  });

  it("with no stale profiles it deletes none and clears no balances", async () => {
    const { prisma, calls } = stubPrisma([]);
    const r = await purgeExpired(prisma, { now: NOW });
    expect(r.upworkProfiles).toBe(0);
    expect(calls.find((c) => c.model === "freelancerProfile" && c.method === "deleteMany")!.args).toEqual({ where: { id: { in: [] } } });
    expect(calls.find((c) => c.model === "account" && c.method === "updateMany")!.args.where).toEqual({ id: { in: [] } });
  });

  it("honours a custom retention period", async () => {
    const { prisma, calls } = stubPrisma();
    await purgeExpired(prisma, { now: NOW, ttlDays: 7 });
    const where = calls.find((c) => c.model === "freelancerProfile" && c.method === "findMany")!.args.where as { capturedAt: { lt: Date } };
    expect(where.capturedAt.lt).toEqual(new Date("2026-10-24T12:00:00.000Z"));
  });
});
