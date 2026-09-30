import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakePrisma } from "./helpers/fake-prisma";

const fake = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof import("./helpers/fake-prisma").createFakePrisma> }));
vi.mock("@/lib/prisma", () => ({
  get prisma() {
    return fake.db;
  },
}));

import { isPlaceholderAccount, memberAccount, syncProfile, unavailableMetrics, upworkIdsWithHiredSource } from "@/lib/dashboard-feed";
import { CreateDraftBody, confirmSubmission, createDraft, syncProposalOutcomes, updateDraft, verifySubmission } from "@/lib/proposals/drafts";
import { linkResponse, syncClientResponses } from "@/lib/responses";
import { completeAuth, startAuth } from "@/lib/upwork/connection";
import { MOCK_DATA, MOCK_META, MOCK_ORG_UID, mockOAuthFetch, mockTransport } from "@/lib/upwork/mock";
import { proposalsFixture, type FakeProposal } from "./helpers/upwork-fixtures";

const m1 = { id: "m1", name: "Bidder One" };
const JOB = "2100000000000000001";
const JOB_URL = `https://www.upwork.com/jobs/~02${JOB}`;

// A realistic (numeric) Upwork org id. The built-in test-mode id is deliberately not numeric
// and must never become an account, so account tests use this one.
const REAL_ORG = "1294000000000000001";
const REAL = { ...MOCK_DATA, list_accounts: { accounts: [{ name: "Real Freelancer", org_uid: REAL_ORG, role: "TALENT" }] } };
const deps = (data: Record<string, unknown> = REAL) => ({ meta: MOCK_META, fetchImpl: mockOAuthFetch(), transport: mockTransport({ data: { ...REAL, ...data } }) });
const connect = async (memberId = "m1") => {
  const { authorizeUrl } = await startAuth(memberId, deps());
  await completeAuth(memberId, { code: "c", state: new URL(authorizeUrl).searchParams.get("state")! }, deps());
};
const newDraft = () =>
  createDraft(m1, CreateDraftBody.parse({ upworkJobId: JOB, jobUrl: JOB_URL, jobTitle: "Laravel REST API", coverLetter: "My letter", proposedRate: "30" }));
const submitted = async () => {
  const d = await newDraft();
  await updateDraft(m1, d.id, { state: "READY" });
  await confirmSubmission(m1, d.id);
  return d.id;
};
const proposals = () => [...fake.db._proposals.values()];
const alerts = () => [...fake.db._alerts.values()];

beforeEach(() => {
  fake.db = createFakePrisma();
  vi.stubEnv("UPWORK_MCP_ENABLED", "true");
  vi.stubEnv("UPWORK_MCP_MOCK", "");
  vi.stubEnv("UPWORK_OAUTH_CLIENT_ID", "client-abc");
  vi.stubEnv("UPWORK_OAUTH_REDIRECT_URI", "http://localhost:3000/api/me/upwork/callback");
});

describe("memberAccount", () => {
  it("gives a not-connected bidder one placeholder account (created once)", async () => {
    const a = await memberAccount(m1);
    const b = await memberAccount(m1);
    expect(a.id).toBe(b.id);
    expect(a).toMatchObject({ freelancerId: "member:m1", name: "Bidder One (Upwork not connected)" });
    expect(isPlaceholderAccount(a.freelancerId as string)).toBe(true);
    expect(fake.db._accountRows.size).toBe(1);
  });

  it("turns the placeholder into the real account on connect, keeping its proposals", async () => {
    const before = await memberAccount(m1);
    const draftId = await submitted();
    await connect();
    const after = await memberAccount(m1);
    expect(after.id).toBe(before.id); // same row → proposals stay attached
    expect(after).toMatchObject({ freelancerId: REAL_ORG, name: "Real Freelancer" });
    expect(fake.db._drafts.get(draftId)!.accountId).toBe(after.id);
    expect(fake.db._accountRows.size).toBe(1);
  });

  it("merges into an existing account for that Upwork id and removes the placeholder", async () => {
    const legacy = await fake.db.account.create({ data: { freelancerId: REAL_ORG, name: "Existing" } });
    const placeholder = await memberAccount(m1);
    const draftId = await submitted();
    await connect();
    const after = await memberAccount(m1);
    expect(after.id).toBe(legacy.id);
    expect(fake.db._accountRows.has(placeholder.id as string)).toBe(false);
    expect(fake.db._drafts.get(draftId)!.accountId).toBe(legacy.id);
    expect(proposals().every((p) => p.accountId === legacy.id)).toBe(true);
    expect(fake.db._keywordMoves).toEqual([{ from: placeholder.id, to: legacy.id }]); // admin keywords move too
  });

  it("a test-mode (made-up) Upwork identity never becomes an account", async () => {
    const mockDeps = { meta: MOCK_META, fetchImpl: mockOAuthFetch(), transport: mockTransport() };
    const { authorizeUrl } = await startAuth("m1", mockDeps);
    await completeAuth("m1", { code: "c", state: new URL(authorizeUrl).searchParams.get("state")! }, mockDeps);
    expect(fake.db._connections.get("m1")!.upworkAccountId).toBe(MOCK_ORG_UID);
    expect(await memberAccount(m1)).toMatchObject({ freelancerId: "member:m1", name: "Bidder One (Upwork not connected)" });
    expect([...fake.db._accountRows.values()].some((a) => a.freelancerId === MOCK_ORG_UID || a.name === "Mock Freelancer")).toBe(false);
  });

  it("two requests at once create one placeholder, not two", async () => {
    const [a, b] = await Promise.all([memberAccount(m1), memberAccount(m1)]);
    expect(a.id).toBe(b.id);
    expect(fake.db._accountRows.size).toBe(1);
  });

  it("creates the real account directly when connected with no placeholder", async () => {
    await connect();
    expect(await memberAccount(m1)).toMatchObject({ freelancerId: REAL_ORG, name: "Real Freelancer" });
  });
});

describe("Proposal feed", () => {
  it("a draft or READY proposal does not appear on the dashboards", async () => {
    const d = await newDraft();
    expect(proposals()).toEqual([]);
    await updateDraft(m1, d.id, { state: "READY" });
    expect(proposals()).toEqual([]);
  });

  it("confirming writes one dashboard proposal with the submitted content", async () => {
    const draftId = await submitted();
    const account = await memberAccount(m1);
    expect(proposals()).toHaveLength(1);
    expect(proposals()[0]).toMatchObject({
      accountId: account.id,
      jobTitle: "Laravel REST API",
      jobUrl: JOB_URL,
      status: "Submitted (self-reported)",
      section: "Submitted",
      coverLetter: "My letter",
      proposedRate: "30",
      submittedViaExtension: false,
      capturedByUserId: "m1",
      submittedByUserId: "m1",
      viewedByClient: false,
      hiredAt: null,
    });
    expect(proposals()[0].submittedAt).toEqual(fake.db._drafts.get(draftId)!.submissionConfirmedAt);
  });

  it("never touches another bidder's row that shares the account and job link", async () => {
    const draftId = await submitted();
    const account = await memberAccount(m1);
    const others = await fake.db.proposal.create({
      data: { accountId: account.id, jobUrl: JOB_URL, jobTitle: "Someone else's", status: "Hired", coverLetter: "theirs", capturedByUserId: "m9" },
    });
    // Feed again (as a verification or refresh would).
    const { feedProposalFromDraft } = await import("@/lib/dashboard-feed");
    await feedProposalFromDraft(fake.db._drafts.get(draftId) as never);
    expect(fake.db._proposals.get(others.id as string)).toMatchObject({ jobTitle: "Someone else's", status: "Hired", coverLetter: "theirs" });
    expect(proposals().filter((p) => p.capturedByUserId === "m1")).toHaveLength(1);
  });

  it("MCP verification updates the same row instead of adding another", async () => {
    await connect();
    const draftId = await submitted();
    const d = deps({ ...MOCK_DATA, list_freelancer_proposals: proposalsFixture([{ id: "p9", status: "Accepted", jobId: JOB }]) });
    expect((await verifySubmission(m1, draftId, d)).verification).toBe("verified");
    expect(proposals()).toHaveLength(1);
    expect(proposals()[0].status).toBe("Submitted (verified by Upwork)");
  });
});

describe("Alert feed", () => {
  it("creates an alert without any message text", async () => {
    await connect();
    await syncClientResponses(m1, deps());
    expect(alerts()).toHaveLength(1);
    const a = alerts()[0];
    expect(a).toMatchObject({
      type: "message",
      title: "Client replied in an interview room",
      roomId: "room_mock1",
      capturedByUserId: "m1",
      needsAttention: true,
      isUnread: true,
      freelancerReplied: false,
    });
    expect(JSON.stringify(a)).not.toContain("can we talk");
    expect(a.preview).toBeUndefined();
    expect(a.lastMessageText).toBeUndefined();
  });

  it("does not create a second alert for the same message", async () => {
    await connect();
    await syncClientResponses(m1, deps());
    await syncClientResponses(m1, deps());
    expect(alerts()).toHaveLength(1);
  });

  it("resolves the alert once the bidder has answered in that room", async () => {
    await connect();
    await syncClientResponses(m1, deps());
    const answered = {
      ...MOCK_DATA,
      get_messages: { status: "ok", data: { rooms: [{ id: "room_mock1", roomType: "INTERVIEW", last_message_from_self: true, latestStory: { id: "s9", createdDateTime: "2026-09-30T09:00:00.000Z" } }] } },
    };
    await syncClientResponses(m1, deps(answered));
    expect(alerts()[0]).toMatchObject({ freelancerReplied: true, needsAttention: false, isUnread: false });
  });

  it("a verified-linked interview moves the dashboard proposal to Interviewing", async () => {
    await connect();
    await submitted();
    const linked = {
      ...MOCK_DATA,
      list_freelancer_proposals: proposalsFixture([{ id: "p1", status: "Accepted", jobId: JOB, roomId: "room_mock1" }]),
    };
    await syncClientResponses(m1, deps(linked));
    expect(proposals()[0].section).toBe("Interviewing");
    expect(alerts()[0].jobTitle).toBe("Laravel REST API");
  });

  it("an unlinked interview leaves the proposal as Submitted until the bidder links it", async () => {
    await connect();
    const draftId = await submitted();
    await syncClientResponses(m1, deps());
    expect(proposals()[0].section).toBe("Submitted");
    const responseId = [...fake.db._responses.keys()][0];
    await linkResponse(m1, responseId, draftId);
    expect(proposals()[0].section).toBe("Interviewing");
  });
});

describe("syncProfile", () => {
  it("flag off → disabled, nothing stored", async () => {
    vi.stubEnv("UPWORK_MCP_ENABLED", "false");
    expect(await syncProfile(m1)).toEqual({ status: "disabled" });
    expect(fake.db._profiles.size).toBe(0);
  });

  it("stores the profile and Connects balance on the bidder's own account", async () => {
    await connect();
    expect(await syncProfile(m1, deps())).toEqual({ status: "ok", provenance: "MCP_VERIFIED", stored: true });
    const account = await memberAccount(m1);
    expect(account.connectsBalance).toBe(120);
    expect(fake.db._profiles.get(account.id as string)).toMatchObject({
      title: "Full-Stack Developer | Laravel & Vue",
      overview: "I build web apps.",
      location: "IS, Pakistan",
      hourlyRate: "$25.0",
      totalEarnings: "$1K+",
      totalJobs: 4,
      skills: ["Laravel", "Vue.js"],
      capturedByUserId: "m1",
    });
  });

  it("mock-mode data is not stored", async () => {
    await connect();
    vi.stubEnv("UPWORK_MCP_MOCK", "true");
    expect(await syncProfile(m1, deps())).toEqual({ status: "ok", provenance: "MOCK", stored: false });
    expect(fake.db._profiles.size).toBe(0);
  });
});

describe("proposal outcomes from Upwork (refresh)", () => {
  const withProposal = (p: Omit<FakeProposal, "id" | "jobId">) =>
    deps({ ...MOCK_DATA, list_freelancer_proposals: proposalsFixture([{ id: "p1", jobId: JOB, ...p }]) });

  it("flag off → disabled, nothing changes", async () => {
    await submitted();
    vi.stubEnv("UPWORK_MCP_ENABLED", "false");
    expect(await syncProposalOutcomes(m1)).toEqual({ status: "disabled" });
    expect(proposals()[0].status).toBe("Submitted (self-reported)");
  });

  it("a submitted proposal found on Upwork becomes verified", async () => {
    await connect();
    const draftId = await submitted();
    expect(await syncProposalOutcomes(m1, withProposal({ status: "Accepted" }))).toMatchObject({ verified: 1, found: 1 });
    expect(fake.db._drafts.get(draftId)!).toMatchObject({ state: "SUBMITTED_CONFIRMED", submissionProvenance: "MCP_VERIFIED" });
    expect(proposals()[0]).toMatchObject({ status: "Submitted (verified by Upwork)", section: "Submitted", hiredAt: null });
  });

  it("Hired sets hiredAt — this is what the Overview counts as hired", async () => {
    await connect();
    await submitted();
    await syncProposalOutcomes(m1, withProposal({ status: "Hired", modified: "2026-09-20T10:00:00.000Z" }));
    expect(proposals()[0]).toMatchObject({ status: "Hired (verified by Upwork)", section: "Active" });
    expect(proposals()[0].hiredAt).toEqual(new Date("2026-09-20T10:00:00.000Z"));
  });

  it("does not move hiredAt on a later refresh", async () => {
    await connect();
    await submitted();
    await syncProposalOutcomes(m1, withProposal({ status: "Hired", modified: "2026-09-20T10:00:00.000Z" }));
    await syncProposalOutcomes(m1, withProposal({ status: "Hired", modified: "2026-09-25T10:00:00.000Z" }));
    expect(proposals()[0].hiredAt).toEqual(new Date("2026-09-20T10:00:00.000Z"));
  });

  it("Offered moves it to the Offers section (counted as interviewed)", async () => {
    await connect();
    await submitted();
    await syncProposalOutcomes(m1, withProposal({ status: "Offered" }));
    expect(proposals()[0]).toMatchObject({ status: "Offer received (verified by Upwork)", section: "Offers", hiredAt: null });
  });

  it("a closed / declined / withdrawn proposal is labelled, never counted as hired", async () => {
    for (const status of ["Archived", "Declined", "Withdrawn"]) {
      fake.db = createFakePrisma();
      await connect();
      await submitted();
      await syncProposalOutcomes(m1, withProposal({ status }));
      expect(proposals()[0].status, status).toBe(`${status} (verified by Upwork)`);
      expect(proposals()[0].hiredAt, status).toBeNull();
    }
  });

  it("a later verification does not overwrite an outcome Upwork already reported", async () => {
    await connect();
    const draftId = await submitted();
    await syncProposalOutcomes(m1, withProposal({ status: "Hired", modified: "2026-09-20T10:00:00.000Z" }));
    const { feedProposalFromDraft } = await import("@/lib/dashboard-feed");
    await feedProposalFromDraft(fake.db._drafts.get(draftId) as never);
    expect(proposals()[0].status).toBe("Hired (verified by Upwork)");
  });

  it("repairs a missing dashboard row on refresh", async () => {
    await connect();
    await submitted();
    fake.db._proposals.clear(); // as if the feed had failed right after the confirm
    await syncProposalOutcomes(m1, withProposal({ status: "Accepted" }));
    expect(proposals()).toHaveLength(1);
    expect(proposals()[0].status).toBe("Submitted (verified by Upwork)");
  });

  it("a proposal Upwork does not list stays self-reported", async () => {
    await connect();
    const draftId = await submitted();
    const other = deps({ ...MOCK_DATA, list_freelancer_proposals: proposalsFixture([{ id: "x", status: "Hired", jobId: "999" }]) });
    expect(await syncProposalOutcomes(m1, other)).toMatchObject({ verified: 0, found: 0 });
    expect(fake.db._drafts.get(draftId)!.state).toBe("SUBMISSION_UNVERIFIED");
    expect(proposals()[0].hiredAt).toBeNull();
  });

  it("mock-mode data changes nothing", async () => {
    await connect();
    const draftId = await submitted();
    vi.stubEnv("UPWORK_MCP_MOCK", "true");
    expect(await syncProposalOutcomes(m1, withProposal({ status: "Hired" }))).toMatchObject({ provenance: "MOCK", verified: 0 });
    expect(fake.db._drafts.get(draftId)!.state).toBe("SUBMISSION_UNVERIFIED");
    expect(proposals()[0].hiredAt).toBeNull();
  });
});

describe("which numbers are shown as unavailable", () => {
  it("viewed always; hired unless that account has a live source", () => {
    expect(unavailableMetrics(false)).toEqual(["viewed", "hired"]);
    expect(unavailableMetrics(true)).toEqual(["viewed"]);
  });

  it("hired has a source only for a connected account that has been refreshed, with the integration on", async () => {
    await connect("m1");
    expect(await upworkIdsWithHiredSource([REAL_ORG])).toEqual(new Set()); // connected but never refreshed
    fake.db._connections.get("m1")!.lastSyncedAt = new Date();
    expect(await upworkIdsWithHiredSource([REAL_ORG])).toEqual(new Set([REAL_ORG]));
    expect(await upworkIdsWithHiredSource(["member:m2", "some-other-org"])).toEqual(new Set()); // a bidder who never connected

    fake.db._connections.get("m1")!.status = "revoked";
    expect(await upworkIdsWithHiredSource([REAL_ORG])).toEqual(new Set());
    fake.db._connections.get("m1")!.status = "connected";

    vi.stubEnv("UPWORK_MCP_ENABLED", "false");
    expect(await upworkIdsWithHiredSource([REAL_ORG])).toEqual(new Set()); // integration off
    vi.stubEnv("UPWORK_MCP_MOCK", "true");
    expect(await upworkIdsWithHiredSource([REAL_ORG])).toEqual(new Set()); // test mode never feeds hired
  });
});
