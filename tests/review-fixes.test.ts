// One test per defect found in the post-push review (2026-09-30). Each was written first
// and seen to fail against the code as pushed, then the code was fixed.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakePrisma } from "./helpers/fake-prisma";

const fake = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof import("./helpers/fake-prisma").createFakePrisma> }));
vi.mock("@/lib/prisma", () => ({
  get prisma() {
    return fake.db;
  },
}));

import { memberAccount, repairProposalRows, upworkIdsWithHiredSource } from "@/lib/dashboard-feed";
import { CreateDraftBody, confirmSubmission, createDraft, syncProposalOutcomes, updateDraft } from "@/lib/proposals/drafts";
import { syncClientResponses } from "@/lib/responses";
import { McpClient } from "@/lib/upwork/client";
import { completeAuth, disconnect, refreshIfNeeded, startAuth, withMcp } from "@/lib/upwork/connection";
import { OAuthStateMismatch, ToolNotAllowed } from "@/lib/upwork/errors";
import { MOCK_DATA, MOCK_META, mockOAuthFetch, mockTransport } from "@/lib/upwork/mock";
import { proposalsFixture } from "./helpers/upwork-fixtures";

const m1 = { id: "m1", name: "Bidder One" };
const m2 = { id: "m2", name: "Bidder Two" };
const JOB = "2100000000000000001";
const JOB_URL = `https://www.upwork.com/jobs/~02${JOB}`;
const REAL_ORG = "1294000000000000001";
const REAL = { ...MOCK_DATA, list_accounts: { accounts: [{ name: "Real Freelancer", org_uid: REAL_ORG, role: "TALENT" }] } };
const deps = (data: Record<string, unknown> = {}) => ({ meta: MOCK_META, fetchImpl: mockOAuthFetch(), transport: mockTransport({ data: { ...REAL, ...data } }) });
const connect = async (memberId = "m1") => {
  const { authorizeUrl } = await startAuth(memberId, deps());
  await completeAuth(memberId, { code: "c", state: new URL(authorizeUrl).searchParams.get("state")! }, deps());
};
const draftBody = (over: Record<string, unknown> = {}) =>
  CreateDraftBody.parse({ upworkJobId: JOB, jobUrl: JOB_URL, jobTitle: "Laravel REST API", coverLetter: "My letter", proposedRate: "30", ...over });
const submitted = async (member = m1) => {
  const d = await createDraft(member, draftBody());
  await updateDraft(member, d.id, { state: "READY" });
  await confirmSubmission(member, d.id);
  return d.id;
};
const proposals = () => [...fake.db._proposals.values()];
const room = (o: Record<string, unknown>) => ({
  id: "room_a",
  roomType: "INTERVIEW",
  last_message_from_self: false,
  latestStory: { id: "story_a", createdDateTime: new Date(Date.now() - 3_600_000).toISOString(), message: "hello" },
  ...o,
});
const rooms = (...list: Record<string, unknown>[]) => ({ status: "ok", hasMore: false, data: { rooms: list } });

beforeEach(() => {
  fake.db = createFakePrisma();
  vi.useRealTimers();
  vi.stubEnv("UPWORK_MCP_ENABLED", "true");
  vi.stubEnv("UPWORK_MCP_MOCK", "");
  vi.stubEnv("UPWORK_OAUTH_CLIENT_ID", "client-abc");
  vi.stubEnv("UPWORK_OAUTH_REDIRECT_URI", "http://localhost:3000/api/me/upwork/callback");
});

describe("hired is only 'known' after proposal outcomes were really read", () => {
  it("a job search (or any other Upwork call) does not make hired known", async () => {
    await connect();
    await withMcp("m1", async (c, orgUid) => c.callTool("find_jobs", { action: "search", org_uid: orgUid, params: {} }), deps());
    expect(await upworkIdsWithHiredSource([REAL_ORG])).toEqual(new Set());
  });

  it("a failed outcome read does not make hired known", async () => {
    await connect();
    await submitted();
    const broken = deps({ list_freelancer_proposals: () => { throw new Error("upstream broke"); } });
    await expect(syncProposalOutcomes(m1, broken)).rejects.toBeTruthy();
    expect(await upworkIdsWithHiredSource([REAL_ORG])).toEqual(new Set());
  });

  it("a successful outcome read does", async () => {
    await connect();
    await syncProposalOutcomes(m1, deps({ list_freelancer_proposals: proposalsFixture([]) }));
    expect(await upworkIdsWithHiredSource([REAL_ORG])).toEqual(new Set([REAL_ORG]));
  });
});

describe("interviews the bidder already answered", () => {
  const linked = { list_freelancer_proposals: proposalsFixture([{ id: "p1", status: "Accepted", jobId: JOB, roomId: "room_a" }]) };

  it("still count as interviewed (the client opened the interview)", async () => {
    await connect();
    await submitted();
    await syncClientResponses(m1, deps({ ...linked, get_messages: rooms(room({ last_message_from_self: true })) }));
    expect(proposals()[0].section).toBe("Interviewing");
    // …but it is not a pending client reply: nothing stored, no alert.
    expect(fake.db._responses.size).toBe(0);
    expect(fake.db._alerts.size).toBe(0);
  });

  it("an ordinary (non-interview) chat the bidder answered changes nothing", async () => {
    await connect();
    await submitted();
    await syncClientResponses(m1, deps({ ...linked, get_messages: rooms(room({ roomType: "ONE_ON_ONE", last_message_from_self: true })) }));
    expect(proposals()[0].section).toBe("Submitted");
  });

  it("an interview room that Upwork does not link to the proposal changes nothing", async () => {
    await connect();
    await submitted();
    await syncClientResponses(m1, deps({ ...linked, get_messages: rooms(room({ id: "room_other", last_message_from_self: true })) }));
    expect(proposals()[0].section).toBe("Submitted");
  });
});

describe("a hired proposal stays hired", () => {
  it("when Upwork later lists it as Archived (contract ended)", async () => {
    await connect();
    await submitted();
    const as = (status: string) => deps({ list_freelancer_proposals: proposalsFixture([{ id: "p1", jobId: JOB, status }]) });
    await syncProposalOutcomes(m1, as("Hired"));
    await syncProposalOutcomes(m1, as("Archived"));
    expect(proposals()[0]).toMatchObject({ status: "Hired (verified by Upwork)", section: "Active" });
    expect(proposals()[0].hiredAt).toBeInstanceOf(Date);
  });
});

describe("one Upwork account, one bidder — also after a disconnect", () => {
  it("a second bidder taking over the account does not share the first bidder's account row", async () => {
    await connect("m1");
    const first = await memberAccount(m1);
    await disconnect("m1", deps());
    await connect("m2");
    const a1 = await memberAccount(m1);
    const a2 = await memberAccount(m2);
    expect(a2.id).toBe(first.id); // the Upwork account now belongs to the bidder connected to it
    expect(a1.id).not.toBe(a2.id); // the former bidder is back on a placeholder of their own
    expect(fake.db._connections.get("m1")!.upworkAccountId).toBeNull();
  });
});

describe("a dashboard write that fails right after confirm", () => {
  it("does not lose the submission: it is recorded, and the row is repaired without Upwork", async () => {
    vi.stubEnv("UPWORK_MCP_ENABLED", "false");
    const d = await createDraft(m1, draftBody());
    await updateDraft(m1, d.id, { state: "READY" });
    const create = fake.db.proposal.create;
    fake.db.proposal.create = (async () => { throw new Error("db hiccup"); }) as typeof create;
    const updated = await confirmSubmission(m1, d.id);
    expect(updated.state).toBe("SUBMISSION_UNVERIFIED");
    expect(proposals()).toHaveLength(0);

    fake.db.proposal.create = create;
    await repairProposalRows(m1.id);
    expect(proposals()).toHaveLength(1);
    await repairProposalRows(m1.id);
    expect(proposals()).toHaveLength(1); // and never a second one
  });
});

describe("token refresh racing with another request", () => {
  it("a refresh that succeeds leaves the connection connected, even if the other request marked it revoked meanwhile", async () => {
    await connect();
    const conn = fake.db._connections.get("m1")!;
    const stale = { ...conn, tokenExpiresAt: new Date(Date.now() - 1000) };
    const inner = mockOAuthFetch();
    // While our refresh is in flight, the other request (whose refresh token was rejected)
    // marks the connection revoked.
    const racing = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const res = await inner(input, init);
      Object.assign(fake.db._connections.get("m1")!, { status: "revoked", accessTokenEnc: null, refreshTokenEnc: null, tokenExpiresAt: null });
      return res;
    }) as typeof fetch;
    await refreshIfNeeded(stale as never, { meta: MOCK_META, fetchImpl: racing, transport: mockTransport() });
    const after = fake.db._connections.get("m1")!;
    expect(after.accessTokenEnc).not.toBeNull();
    expect(after.status).toBe("connected");
  });

  it("but never resurrects a connection the bidder disconnected meanwhile", async () => {
    await connect();
    const conn = fake.db._connections.get("m1")!;
    const stale = { ...conn, tokenExpiresAt: new Date(Date.now() - 1000) };
    const inner = mockOAuthFetch();
    const racing = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const res = await inner(input, init);
      Object.assign(fake.db._connections.get("m1")!, { status: "disconnected", accessTokenEnc: null, refreshTokenEnc: null, tokenExpiresAt: null });
      return res;
    }) as typeof fetch;
    await refreshIfNeeded(stale as never, { meta: MOCK_META, fetchImpl: racing, transport: mockTransport() }).catch(() => {});
    expect(fake.db._connections.get("m1")!).toMatchObject({ status: "disconnected", accessTokenEnc: null });
  });
});

describe("the Upwork sign-in attempt", () => {
  it("expires 10 minutes after it was started, whatever else touched the row since", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-30T10:00:00Z"));
    const { authorizeUrl } = await startAuth("m1", deps());
    const state = new URL(authorizeUrl).searchParams.get("state")!;
    vi.setSystemTime(new Date("2026-09-30T10:09:00Z"));
    fake.db._connections.get("m1")!.updatedAt = new Date(); // e.g. a "Refresh activity" write
    vi.setSystemTime(new Date("2026-09-30T10:11:00Z"));
    await expect(completeAuth("m1", { code: "c", state }, deps())).rejects.toBeInstanceOf(OAuthStateMismatch);
  });

  it("can be redeemed once only, even by two callbacks at the same moment", async () => {
    const { authorizeUrl } = await startAuth("m1", deps());
    const state = new URL(authorizeUrl).searchParams.get("state")!;
    const results = await Promise.allSettled([
      completeAuth("m1", { code: "c", state }, deps()),
      completeAuth("m1", { code: "c", state }, deps()),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: expect.any(OAuthStateMismatch) });
  });
});

describe("small input rules", () => {
  it("a bid of 0 is not a bid", () => {
    expect(CreateDraftBody.safeParse({ jobUrl: JOB_URL, jobTitle: "x", proposedRate: "0" }).success).toBe(false);
    expect(CreateDraftBody.safeParse({ jobUrl: JOB_URL, jobTitle: "x", fixedBidAmount: "0.00", bidType: "fixed" }).success).toBe(false);
    expect(CreateDraftBody.safeParse({ jobUrl: JOB_URL, jobTitle: "x", proposedRate: "0.50" }).success).toBe(true);
  });

  it("an allowed Upwork tool can only be called with its known read actions", async () => {
    const client = new McpClient("https://mcp.upwork.test/mcp", "t", mockTransport());
    await client.initialize();
    await expect(client.callTool("get_profile", { action: "update", org_uid: "1" })).rejects.toBeInstanceOf(ToolNotAllowed);
    await expect(client.callTool("list_freelancer_proposals", { action: "withdraw", org_uid: "1" })).rejects.toBeInstanceOf(ToolNotAllowed);
    await expect(client.callTool("get_profile", { action: "get", org_uid: "1" })).resolves.toBeTruthy();
    await expect(client.callTool("list_accounts")).resolves.toBeTruthy();
  });
});
