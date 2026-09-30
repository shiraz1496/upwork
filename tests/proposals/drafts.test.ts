import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakePrisma } from "../helpers/fake-prisma";

const fake = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof import("../helpers/fake-prisma").createFakePrisma> }));
vi.mock("@/lib/prisma", () => ({
  get prisma() {
    return fake.db;
  },
}));

import { ForbiddenError } from "@/lib/member-auth";
import {
  CreateDraftBody,
  confirmSubmission,
  createDraft,
  deleteDraft,
  DraftError,
  jobIdKey,
  listDrafts,
  serializeDraft,
  UpdateDraftBody,
  updateDraft,
  verifySubmission,
} from "@/lib/proposals/drafts";
import { completeAuth, startAuth } from "@/lib/upwork/connection";
import { jobIdFromUrl } from "@/lib/upwork/ids";
import { MOCK_DATA, MOCK_META, mockOAuthFetch, mockTransport } from "@/lib/upwork/mock";
import { proposalsFixture, type FakeProposal } from "../helpers/upwork-fixtures";

const m1 = { id: "m1", name: "Bidder One" };
const m2 = { id: "m2", name: "Bidder Two" };
const body = (over: Record<string, unknown> = {}) =>
  CreateDraftBody.parse({
    upworkJobId: "~022105140434795735776",
    jobUrl: "https://www.upwork.com/jobs/~022105140434795735776",
    jobTitle: "Laravel developer",
    coverLetter: "Hello, I can help.",
    bidType: "hourly",
    proposedRate: "25",
    ...over,
  });
const code = (p: Promise<unknown>) => p.then(() => "no error", (e) => (e instanceof DraftError ? e.code : e));

beforeEach(() => {
  fake.db = createFakePrisma();
  vi.stubEnv("UPWORK_MCP_ENABLED", "false");
  vi.stubEnv("UPWORK_MCP_MOCK", "");
  vi.stubEnv("UPWORK_OAUTH_CLIENT_ID", "client-abc");
  vi.stubEnv("UPWORK_OAUTH_REDIRECT_URI", "http://localhost:3000/api/me/upwork/callback");
});

describe("input validation", () => {
  it("only accepts real upwork.com job links", () => {
    expect(() => body({ jobUrl: "https://evil.example/jobs/~022105140434795735776" })).toThrow();
    expect(() => body({ jobUrl: "http://www.upwork.com/jobs/~022105140434795735776" })).toThrow();
    expect(() => body({ jobUrl: "https://upwork.com.evil.example/jobs/~022105140434795735776" })).toThrow();
    expect(body({ jobUrl: "https://www.upwork.com/jobs/~022105140434795735776" }).jobUrl).toContain("upwork.com");
  });
  it("the link must point at a job (it must carry a job id)", () => {
    expect(() => body({ jobUrl: "https://www.upwork.com/nx/find-work/" })).toThrow();
    expect(() => body({ jobUrl: "https://www.upwork.com/jobs/~021" })).toThrow();
    expect(body({ jobUrl: "https://www.upwork.com/jobs/Laravel-dev_~01a1b2c3d4e5f6a7b8/" }).jobUrl).toContain("~01");
  });
  it("works out the job id from the link, in one normal form", () => {
    expect(jobIdFromUrl("https://www.upwork.com/jobs/~022105140434795735776")).toBe("2105140434795735776");
    expect(jobIdFromUrl("https://www.upwork.com/jobs/Some-title_~022105140434795735776/?ref=x")).toBe("2105140434795735776");
    expect(jobIdFromUrl("https://www.upwork.com/jobs/Old_~01A1B2C3D4E5F6A7B8/")).toBe("~01a1b2c3d4e5f6a7b8");
    expect(jobIdFromUrl("https://www.upwork.com/freelancers/someone")).toBeNull();
  });
  it("amounts must be plain numbers", () => {
    expect(() => body({ proposedRate: "25 usd" })).toThrow();
    expect(() => body({ proposedRate: "-5" })).toThrow();
    expect(body({ proposedRate: "25.50" }).proposedRate).toBe("25.50");
  });
  it("PATCH cannot set a submitted state directly", () => {
    expect(() => UpdateDraftBody.parse({ state: "SUBMISSION_UNVERIFIED" })).toThrow();
    expect(() => UpdateDraftBody.parse({ state: "SUBMITTED_CONFIRMED" })).toThrow();
  });
  it("treats different spellings of a job id as the same job", () => {
    expect(jobIdKey("~022105140434795735776")).toBe("2105140434795735776");
    expect(jobIdKey("2105140434795735776")).toBe("2105140434795735776");
  });
});

describe("create / list", () => {
  it("creates a DRAFT owned by the session member with an initial event", async () => {
    const d = await createDraft(m1, body());
    expect(d).toMatchObject({ memberId: "m1", state: "DRAFT", jobDataProvenance: "APP_RECORDED", upworkJobId: "2105140434795735776" });
    expect(serializeDraft(d).events).toEqual([expect.objectContaining({ fromState: null, toState: "DRAFT" })]);
  });
  it("saving a draft never marks it submitted", async () => {
    const d = await createDraft(m1, body());
    expect(d.state).toBe("DRAFT");
    expect(d.submissionConfirmedAt).toBeNull();
    expect(d.submissionProvenance).toBeNull();
  });
  it("stores the job id from the link, and refuses a client-sent id that disagrees with it", async () => {
    const d = await createDraft(m1, CreateDraftBody.parse({ jobUrl: "https://www.upwork.com/jobs/~022105140434795735776", jobTitle: "T" }));
    expect(d.upworkJobId).toBe("2105140434795735776"); // no upworkJobId sent at all
    expect(await code(createDraft(m2, body({ upworkJobId: "999999999999" })))).toBe("job_mismatch");
  });
  it("refuses a second proposal for the same job by the same member", async () => {
    await createDraft(m1, body());
    expect(await code(createDraft(m1, body({ upworkJobId: "2105140434795735776" })))).toBe("duplicate");
    await expect(createDraft(m2, body())).resolves.toBeTruthy(); // another member may have their own
  });
  it("always attaches the proposal to the bidder's own account, never a client-sent one", async () => {
    const d = await createDraft(m1, body({ accountId: "someone-elses-account" } as never));
    const own = [...fake.db._accountRows.values()].find((a) => a.freelancerId === "member:m1")!;
    expect(d.accountId).toBe(own.id);
    expect(own.name).toBe("Bidder One (Upwork not connected)");
  });
  it("lists only the member's own proposals", async () => {
    await createDraft(m1, body());
    await createDraft(m2, body());
    expect((await listDrafts(m1)).map((d) => d.memberId)).toEqual(["m1"]);
  });
});

describe("ownership", () => {
  it("another member cannot edit, confirm, verify or delete", async () => {
    const d = await createDraft(m1, body());
    await expect(updateDraft(m2, d.id, { coverLetter: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(confirmSubmission(m2, d.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(verifySubmission(m2, d.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(deleteDraft(m2, d.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect(fake.db._drafts.get(d.id)!.coverLetter).toBe("Hello, I can help.");
  });
  it("unknown id → not_found", async () => {
    expect(await code(updateDraft(m1, "missing", {}))).toBe("not_found");
  });
});

describe("workflow", () => {
  it("edit → READY → confirm produces SUBMISSION_UNVERIFIED + snapshot + events", async () => {
    const d = await createDraft(m1, body({ coverLetter: "" }));
    expect(await code(updateDraft(m1, d.id, { state: "READY" }))).toBe("invalid_transition"); // empty cover letter

    const ready = await updateDraft(m1, d.id, { coverLetter: "Final letter", proposedRate: "30", state: "READY" });
    expect(ready.state).toBe("READY");

    const confirmed = await confirmSubmission(m1, d.id, "sent it");
    expect(confirmed).toMatchObject({
      state: "SUBMISSION_UNVERIFIED",
      submittedCoverLetter: "Final letter",
      submittedBidAmount: "30",
      submissionProvenance: "DEVELOPER_CONFIRMED",
    });
    expect(confirmed.submissionConfirmedAt).toBeInstanceOf(Date);
    expect(serializeDraft(confirmed).events!.map((e) => `${e.fromState}>${e.toState}`)).toEqual([
      "null>DRAFT",
      "DRAFT>READY",
      "READY>SUBMISSION_UNVERIFIED",
    ]);
  });

  it("cannot confirm a draft that is not READY", async () => {
    const d = await createDraft(m1, body());
    expect(await code(confirmSubmission(m1, d.id))).toBe("invalid_transition");
  });

  it("READY must go back to DRAFT before editing", async () => {
    const d = await createDraft(m1, body());
    await updateDraft(m1, d.id, { state: "READY" });
    expect(await code(updateDraft(m1, d.id, { coverLetter: "changed" }))).toBe("not_editable");
    await updateDraft(m1, d.id, { state: "DRAFT" });
    await expect(updateDraft(m1, d.id, { coverLetter: "changed" })).resolves.toMatchObject({ coverLetter: "changed" });
  });

  it("a recorded submission cannot be edited or deleted", async () => {
    const d = await createDraft(m1, body());
    await updateDraft(m1, d.id, { state: "READY" });
    await confirmSubmission(m1, d.id);
    expect(await code(updateDraft(m1, d.id, { coverLetter: "x" }))).toBe("not_editable");
    expect(await code(deleteDraft(m1, d.id))).toBe("not_deletable");
  });

  it("drafts can be deleted", async () => {
    const d = await createDraft(m1, body());
    await deleteDraft(m1, d.id);
    expect(await listDrafts(m1)).toEqual([]);
  });
});

describe("changing the job link of a draft", () => {
  const OTHER = "https://www.upwork.com/jobs/~022999999999999999999";

  it("the stored job id follows the new link", async () => {
    const d = await createDraft(m1, body());
    const updated = await updateDraft(m1, d.id, { jobUrl: OTHER });
    expect(updated).toMatchObject({ jobUrl: OTHER, upworkJobId: "2999999999999999999" });
  });
  it("cannot be pointed at a job the bidder already has a proposal for", async () => {
    await createDraft(m1, body({ jobUrl: OTHER, upworkJobId: undefined }));
    const d = await createDraft(m1, body());
    expect(await code(updateDraft(m1, d.id, { jobUrl: OTHER }))).toBe("duplicate");
    expect(fake.db._drafts.get(d.id)!.upworkJobId).toBe("2105140434795735776");
  });
  it("re-saving the same link is not a duplicate of itself", async () => {
    const d = await createDraft(m1, body());
    await expect(updateDraft(m1, d.id, { jobUrl: d.jobUrl as string, coverLetter: "x" })).resolves.toBeTruthy();
  });
  it("a verification then checks the NEW job, not the old one", async () => {
    vi.stubEnv("UPWORK_MCP_ENABLED", "true");
    const d = await createDraft(m1, body());
    await updateDraft(m1, d.id, { jobUrl: OTHER, state: "READY" });
    await confirmSubmission(m1, d.id);
    // Upwork only has a proposal for the OLD job.
    const deps = {
      meta: MOCK_META,
      fetchImpl: mockOAuthFetch(),
      transport: mockTransport({ data: { ...MOCK_DATA, list_freelancer_proposals: proposalsFixture([{ id: "p", status: "Accepted", jobId: "2105140434795735776" }]) } }),
    };
    const { authorizeUrl } = await startAuth("m1", deps);
    await completeAuth("m1", { code: "c", state: new URL(authorizeUrl).searchParams.get("state")! }, deps);
    expect((await verifySubmission(m1, d.id, deps)).verification).toBe("not_found");
  });
});

describe("two requests at the same time", () => {
  const ready = async () => {
    const d = await createDraft(m1, body());
    await updateDraft(m1, d.id, { state: "READY" });
    return d.id;
  };
  const outcomes = (r: PromiseSettledResult<unknown>[]) =>
    r.map((x) => (x.status === "fulfilled" ? "ok" : x.reason instanceof DraftError ? x.reason.code : String(x.reason)));

  it("confirm + back-to-draft: exactly one wins; a recorded submission is never left editable", async () => {
    const id = await ready();
    const r = await Promise.allSettled([confirmSubmission(m1, id), updateDraft(m1, id, { state: "DRAFT" })]);
    expect(outcomes(r).sort()).toEqual(["conflict", "ok"]);
    const d = fake.db._drafts.get(id)!;
    // Whichever won, the result is consistent: submitted ⇔ has a dashboard row.
    expect(d.state === "SUBMISSION_UNVERIFIED").toBe(fake.db._proposals.size === 1);
    if (d.state === "DRAFT") expect(d.submissionConfirmedAt).toBeNull();
  });

  it("two confirms: one proposal row, one audit event — never counted twice", async () => {
    const id = await ready();
    const r = await Promise.allSettled([confirmSubmission(m1, id), confirmSubmission(m1, id)]);
    expect(outcomes(r).sort()).toEqual(["conflict", "ok"]);
    expect(fake.db._proposals.size).toBe(1);
    expect((fake.db._drafts.get(id)!._events as unknown[]).filter((e) => (e as { toState: string }).toState === "SUBMISSION_UNVERIFIED")).toHaveLength(1);
  });

  it("confirm + delete: never a dashboard row without its proposal", async () => {
    const id = await ready();
    const r = await Promise.allSettled([confirmSubmission(m1, id), deleteDraft(m1, id)]);
    expect(outcomes(r).sort()).toEqual(["conflict", "ok"]);
    expect(fake.db._drafts.has(id)).toBe(fake.db._proposals.size === 1);
  });

  it("two edits of a draft both go through (no state change involved)", async () => {
    const d = await createDraft(m1, body());
    const r = await Promise.allSettled([updateDraft(m1, d.id, { coverLetter: "a" }), updateDraft(m1, d.id, { proposedRate: "40" })]);
    expect(outcomes(r)).toEqual(["ok", "ok"]);
  });
});

describe("verifySubmission (MCP)", () => {
  const submitted = async () => {
    const d = await createDraft(m1, body());
    await updateDraft(m1, d.id, { state: "READY" });
    await confirmSubmission(m1, d.id);
    return d.id;
  };
  const withProposals = (proposals: FakeProposal[]) => ({
    meta: MOCK_META,
    fetchImpl: mockOAuthFetch(),
    transport: mockTransport({ data: { ...MOCK_DATA, list_freelancer_proposals: proposalsFixture(proposals) } }),
  });
  const connect = async (deps: ReturnType<typeof withProposals>) => {
    const { authorizeUrl } = await startAuth("m1", deps);
    await completeAuth("m1", { code: "c", state: new URL(authorizeUrl).searchParams.get("state")! }, deps);
  };

  it("integration off → 'disabled', state unchanged", async () => {
    const id = await submitted();
    const r = await verifySubmission(m1, id);
    expect(r.verification).toBe("disabled");
    expect(fake.db._drafts.get(id)!.state).toBe("SUBMISSION_UNVERIFIED");
  });

  it("promotes to SUBMITTED_CONFIRMED only when Upwork's list has the same job", async () => {
    vi.stubEnv("UPWORK_MCP_ENABLED", "true");
    const id = await submitted();
    const deps = withProposals([{ id: "prop-9", status: "Accepted", jobId: "2105140434795735776" }]);
    await connect(deps);
    const r = await verifySubmission(m1, id, deps);
    expect(r.verification).toBe("verified");
    expect(r.draft).toMatchObject({ state: "SUBMITTED_CONFIRMED", submissionProvenance: "MCP_VERIFIED" });
  });

  it("stays unverified when Upwork's list does not have the job", async () => {
    vi.stubEnv("UPWORK_MCP_ENABLED", "true");
    const id = await submitted();
    const deps = withProposals([{ id: "prop-1", status: "Accepted", jobId: "999" }]);
    await connect(deps);
    const r = await verifySubmission(m1, id, deps);
    expect(r.verification).toBe("not_found");
    expect(fake.db._drafts.get(id)!.state).toBe("SUBMISSION_UNVERIFIED");
  });

  it("mock-mode data can never promote a proposal", async () => {
    vi.stubEnv("UPWORK_MCP_MOCK", "true");
    const id = await submitted();
    const deps = withProposals([{ id: "prop-9", status: "Accepted", jobId: "2105140434795735776" }]);
    await connect(deps);
    const r = await verifySubmission(m1, id, deps);
    expect(r.verification).toBe("not_found");
    expect(fake.db._drafts.get(id)!.state).toBe("SUBMISSION_UNVERIFIED");
  });

  it("a proposal that already moved on (Hired / closed job) still proves it was submitted", async () => {
    vi.stubEnv("UPWORK_MCP_ENABLED", "true");
    for (const status of ["Hired", "Offered", "Archived", "Declined", "Withdrawn"]) {
      fake.db = createFakePrisma();
      const id = await submitted();
      const deps = withProposals([{ id: "p", status, jobId: "2105140434795735776" }]);
      await connect(deps);
      expect((await verifySubmission(m1, id, deps)).verification, status).toBe("verified");
    }
  });

  it("only a recorded submission can be verified", async () => {
    const d = await createDraft(m1, body());
    expect(await code(verifySubmission(m1, d.id))).toBe("invalid_transition");
  });
});
