import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakePrisma } from "../helpers/fake-prisma";

const fake = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof import("../helpers/fake-prisma").createFakePrisma> }));
vi.mock("@/lib/prisma", () => ({
  get prisma() {
    return fake.db;
  },
}));

import { listAccounts } from "@/lib/upwork/account";
import { completeAuth, startAuth } from "@/lib/upwork/connection";
import { listContracts } from "@/lib/upwork/contracts";
import { findJobs } from "@/lib/upwork/jobs";
import { listRooms } from "@/lib/upwork/messages";
import { MOCK_META, MOCK_ORG_UID, mockOAuthFetch, mockTransport } from "@/lib/upwork/mock";
import { McpClient } from "@/lib/upwork/client";
import { ToolNotAllowed } from "@/lib/upwork/errors";
import { listSubmittedProposals } from "@/lib/upwork/proposals";

type Call = { name?: string; arguments?: Record<string, unknown> };
const deps = (calls?: Call[]) => ({
  meta: MOCK_META,
  fetchImpl: mockOAuthFetch(),
  transport: mockTransport({ onCall: (method, params) => method === "tools/call" && calls?.push(params as Call) }),
});

beforeEach(() => {
  fake.db = createFakePrisma();
  vi.stubEnv("UPWORK_MCP_MOCK", "");
  vi.stubEnv("UPWORK_OAUTH_CLIENT_ID", "client-abc");
  vi.stubEnv("UPWORK_OAUTH_REDIRECT_URI", "http://localhost:3000/api/me/upwork/callback");
});

describe("services with the flag off", () => {
  it("return disabled with no data (never fabricated)", async () => {
    vi.stubEnv("UPWORK_MCP_ENABLED", "false");
    const results = [
      await findJobs("m1", "search"),
      await listRooms("m1"),
      await listContracts("m1"),
      await listSubmittedProposals("m1"),
      await listAccounts("m1"),
    ];
    for (const r of results) expect(r).toEqual({ status: "disabled", provenance: null, data: null });
  });
});

describe("services with the flag on (mocked MCP, live-server shapes)", () => {
  beforeEach(async () => {
    vi.stubEnv("UPWORK_MCP_ENABLED", "true");
    const { authorizeUrl } = await startAuth("m1", deps());
    await completeAuth("m1", { code: "c", state: new URL(authorizeUrl).searchParams.get("state")! }, deps());
  });

  it("findJobs sends {action, org_uid, params} and returns normalized jobs marked MCP_VERIFIED", async () => {
    const calls: Call[] = [];
    const r = await findJobs("m1", "search", { title: "Laravel", limit: 2 }, deps(calls));
    expect(calls[0]).toEqual({
      name: "upwork__find_jobs",
      arguments: { action: "search", org_uid: MOCK_ORG_UID, params: { title: "Laravel", limit: 2 } },
    });
    if (r.status !== "ok") throw new Error("expected ok");
    expect(r.provenance).toBe("MCP_VERIFIED");
    expect(r.data[0]).toMatchObject({
      upworkJobId: "2100000000000000001",
      jobType: "hourly",
      budgetMin: 25,
      budgetMax: 45,
      skills: ["Laravel", "REST API", "MySQL"],
      url: "https://www.upwork.com/jobs/~022100000000000000001", // tracking params stripped
      descriptionSnippet: "Need an experienced Laravel developer to build a REST API.", // wrapper tags stripped
      client: { country: "United States", rating: 4.9, totalSpent: 7233.56, paymentVerified: true },
    });
    expect(r.data[1]).toMatchObject({ jobType: "fixed", budgetMin: 50, budgetMax: 50 });
    // unknown stays null, never zero
    expect(r.data[1].client).toMatchObject({ rating: null, totalSpent: null, paymentVerified: null });
  });

  it("listRooms maps rooms, flags who wrote last, and keeps only a short snippet", async () => {
    const r = await listRooms("m1", {}, deps());
    if (r.status !== "ok") throw new Error("expected ok");
    expect(r.data[0]).toEqual({
      upworkThreadId: "room_mock1",
      upworkMessageId: "story_mock1",
      kind: "interview",
      lastMessageAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      lastMessageFromSelf: false,
      unread: 1,
      snippet: "Hi, can we talk tomorrow?",
    });
    expect(r.data[1]).toMatchObject({ kind: "message", lastMessageFromSelf: true });
    expect(r.data.every((m) => (m.snippet ?? "").length <= 200)).toBe(true);
  });

  it("listContracts maps the freelancer contract list", async () => {
    const r = await listContracts("m1", {}, deps());
    if (r.status !== "ok") throw new Error("expected ok");
    expect(r.data).toEqual([
      expect.objectContaining({ upworkContractId: "40000001", status: "ACTIVE", clientName: "Mock Client Co", upworkOfferId: "100000001" }),
    ]);
  });

  it("listSubmittedProposals asks for status Accepted (= submitted) and handles an empty list", async () => {
    const calls: Call[] = [];
    const r = await listSubmittedProposals("m1", {}, deps(calls));
    expect(calls[0].arguments).toEqual({ action: "list", org_uid: MOCK_ORG_UID, params: { status: "Accepted" } });
    expect(r.status === "ok" && r.data).toEqual([]);
  });

  it("listAccounts shows every account the login can act as", async () => {
    const r = await listAccounts("m1", deps());
    if (r.status !== "ok") throw new Error("expected ok");
    expect(r.data.map((a) => a.role)).toEqual(["TALENT", "FL_AGENCY"]);
  });

  it("labels mock-mode data as MOCK, never MCP_VERIFIED", async () => {
    vi.stubEnv("UPWORK_MCP_MOCK", "true");
    const r = await findJobs("m1", "search", {}, deps());
    expect(r.status === "ok" && r.provenance).toBe("MOCK");
  });
});

describe("read-only guard", () => {
  it.each(["send_message", "manage_proposals", "confirm_draft", "respond_to_offer", "submit_milestones", "update_profile", "save_job", "get_account"])(
    "the client refuses to call %s, even if the server offers it",
    async (tool) => {
      const client = new McpClient("https://mcp.upwork.test/mcp", "t", mockTransport({ tools: [`upwork__${tool}`], data: { [tool]: { status: "ok" } } }));
      await client.initialize();
      await expect(client.callTool(tool, { action: "x", org_uid: "1" })).rejects.toBeInstanceOf(ToolNotAllowed);
    },
  );
});
