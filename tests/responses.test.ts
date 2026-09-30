import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakePrisma } from "./helpers/fake-prisma";

const fake = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof import("./helpers/fake-prisma").createFakePrisma> }));
vi.mock("@/lib/prisma", () => ({
  get prisma() {
    return fake.db;
  },
}));

import { ForbiddenError } from "@/lib/member-auth";
import { CreateDraftBody, confirmSubmission, createDraft, DraftError, updateDraft } from "@/lib/proposals/drafts";
import { linkResponse, listResponses, serializeResponse, syncClientResponses } from "@/lib/responses";
import { completeAuth, startAuth } from "@/lib/upwork/connection";
import { MOCK_DATA, MOCK_META, mockOAuthFetch, mockTransport } from "@/lib/upwork/mock";
import { proposalsFixture } from "./helpers/upwork-fixtures";

const m1 = { id: "m1", name: "Bidder One" };
const m2 = { id: "m2", name: "Bidder Two" };
const JOB = "2100000000000000001";

// One submitted proposal for JOB, with the room Upwork links to it (null = no room).
const withRoom = (roomId: string | null) => proposalsFixture([{ id: "prop-1", status: "Accepted", jobId: JOB, roomId }]);

const deps = (proposals: unknown = MOCK_DATA.list_freelancer_proposals, calls?: string[]) => ({
  meta: MOCK_META,
  fetchImpl: mockOAuthFetch(),
  transport: mockTransport({
    data: { ...MOCK_DATA, list_freelancer_proposals: proposals },
    onCall: (method, params) => {
      if (method !== "tools/call") return;
      const p = params as { name: string; arguments?: { action?: string } };
      calls?.push(`${p.name.split("__").pop()}:${p.arguments?.action ?? ""}`);
    },
  }),
});
const connect = async (id = "m1") => {
  const { authorizeUrl } = await startAuth(id, deps());
  await completeAuth(id, { code: "c", state: new URL(authorizeUrl).searchParams.get("state")! }, deps());
};
const submittedDraft = async (member = m1) => {
  const d = await createDraft(
    member,
    CreateDraftBody.parse({ upworkJobId: JOB, jobUrl: `https://www.upwork.com/jobs/~02${JOB}`, jobTitle: "Laravel REST API", coverLetter: "Hi", proposedRate: "25" }),
  );
  await updateDraft(member, d.id, { state: "READY" });
  await confirmSubmission(member, d.id);
  return d.id;
};

beforeEach(() => {
  fake.db = createFakePrisma();
  vi.stubEnv("UPWORK_MCP_ENABLED", "true");
  vi.stubEnv("UPWORK_MCP_MOCK", "");
  vi.stubEnv("UPWORK_OAUTH_CLIENT_ID", "client-abc");
  vi.stubEnv("UPWORK_OAUTH_REDIRECT_URI", "http://localhost:3000/api/me/upwork/callback");
});

describe("syncClientResponses", () => {
  it("flag off → disabled, nothing stored", async () => {
    vi.stubEnv("UPWORK_MCP_ENABLED", "false");
    expect(await syncClientResponses(m1)).toEqual({ status: "disabled" });
    expect(fake.db._responses.size).toBe(0);
  });

  it("stores only rooms where the client wrote last", async () => {
    await connect();
    const r = await syncClientResponses(m1, deps());
    expect(r).toMatchObject({ status: "ok", provenance: "MCP_VERIFIED", stored: 1, clientRooms: 1 });
    const rows = [...fake.db._responses.values()];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      memberId: "m1",
      upworkThreadId: "room_mock1", // room_mock2's last message is the bidder's own → skipped
      upworkMessageId: "story_mock1",
      kind: "interview",
      snippet: "Hi, can we talk tomorrow?",
      provenance: "MCP_VERIFIED",
    });
  });

  it("sets a retention expiry on the stored snippet", async () => {
    await connect();
    await syncClientResponses(m1, deps());
    const row = [...fake.db._responses.values()][0];
    const days = ((row.expiresAt as Date).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThan(31);
  });

  it("running it twice does not duplicate", async () => {
    await connect();
    await syncClientResponses(m1, deps());
    const second = await syncClientResponses(m1, deps());
    expect(second).toMatchObject({ stored: 0 });
    expect(fake.db._responses.size).toBe(1);
  });

  it("with no verified link the response needs manual association", async () => {
    await connect();
    await submittedDraft(); // a proposal exists, but Upwork reports no submitted proposals
    const r = await syncClientResponses(m1, deps());
    expect(r).toMatchObject({ stored: 1, linked: 0, needManualLink: 1 });
    const row = [...fake.db._responses.values()][0];
    expect(row).toMatchObject({ draftId: null, associationMethod: "manual" });
  });

  it("links by the room Upwork returns for the proposal (verified identifier)", async () => {
    await connect();
    const draftId = await submittedDraft();
    const calls: string[] = [];
    const r = await syncClientResponses(m1, deps(withRoom("room_mock1"), calls));
    expect(r).toMatchObject({ stored: 1, linked: 1, needManualLink: 0, linkingAvailable: true });
    expect([...fake.db._responses.values()][0]).toMatchObject({ draftId, associationMethod: "verified_identifier" });
    expect(calls).toContain("list_freelancer_proposals:get");
  });

  it("does NOT link when the proposal's room is a different room", async () => {
    await connect();
    await submittedDraft();
    await syncClientResponses(m1, deps(withRoom("room_other")));
    expect([...fake.db._responses.values()][0]).toMatchObject({ draftId: null, associationMethod: "manual" });
  });

  it("with no room from Upwork for the proposal, the reply stays unlinked", async () => {
    await connect();
    await submittedDraft();
    await syncClientResponses(m1, deps(withRoom(null)));
    expect([...fake.db._responses.values()][0].draftId).toBeNull();
  });

  it("a reply stored unlinked is linked on a later refresh, once Upwork gives the room", async () => {
    await connect();
    await syncClientResponses(m1, deps()); // no proposal recorded yet → stored unlinked
    const draftId = await submittedDraft();
    const r = await syncClientResponses(m1, deps(withRoom("room_mock1")));
    expect(r).toMatchObject({ stored: 0, linked: 1 });
    expect([...fake.db._responses.values()][0]).toMatchObject({ draftId, associationMethod: "verified_identifier" });
    expect(fake.db._responses.size).toBe(1); // still one row, no duplicate
  });

  it("old conversations are not turned into new alerts", async () => {
    await connect();
    const old = new Date(Date.now() - 45 * 86_400_000).toISOString();
    const rooms = { status: "ok", data: { rooms: [
      { id: "room_old", roomType: "INTERVIEW", last_message_from_self: false, latestStory: { id: "s_old", createdDateTime: old, message: "old" } },
      { id: "room_undated", roomType: "INTERVIEW", last_message_from_self: false, latestStory: { id: "s_x", message: "no date" } },
    ] } };
    const d = { meta: MOCK_META, fetchImpl: mockOAuthFetch(), transport: mockTransport({ data: { ...MOCK_DATA, get_messages: rooms } }) };
    expect(await syncClientResponses(m1, d)).toMatchObject({ stored: 0, clientRooms: 0 });
    expect(fake.db._alerts.size).toBe(0);
  });

  it("a failing room lookup does not break the sync", async () => {
    await connect();
    await submittedDraft();
    const failing = (args: Record<string, unknown>) =>
      args.action === "get" ? { status: "error", message: "boom" } : withRoom(null)(args);
    const r = await syncClientResponses(m1, deps(failing));
    expect(r).toMatchObject({ stored: 1, linked: 0 });
  });

  it("does not look up rooms when there is nothing to link", async () => {
    await connect();
    const calls: string[] = [];
    await syncClientResponses(m1, deps(undefined, calls)); // no submitted drafts
    expect(calls).toEqual(["get_messages:list_rooms"]);
  });

  it("mock-mode data is not stored", async () => {
    await connect();
    vi.stubEnv("UPWORK_MCP_MOCK", "true");
    const r = await syncClientResponses(m1, deps());
    expect(r).toEqual({ status: "ok", provenance: "MOCK", stored: 0, clientRooms: 1 });
    expect(fake.db._responses.size).toBe(0);
  });

  it("only uses the caller's own connection and rows", async () => {
    await connect("m1");
    await syncClientResponses(m1, deps());
    expect(await listResponses(m2)).toEqual([]);
    expect((await listResponses(m1)).map((r) => r.memberId)).toEqual(["m1"]);
  });
});

describe("manual association", () => {
  const stored = async () => {
    await connect();
    await syncClientResponses(m1, deps());
    return [...fake.db._responses.values()][0].id as string;
  };

  it("links and unlinks one of the member's own proposals", async () => {
    const id = await stored();
    const draftId = await submittedDraft();
    const linked = await linkResponse(m1, id, draftId);
    expect(serializeResponse(linked)).toMatchObject({
      associationMethod: "manual",
      needsManualAssociation: false,
      proposal: { id: draftId, jobTitle: "Laravel REST API" },
    });
    const unlinked = await linkResponse(m1, id, null);
    expect(serializeResponse(unlinked)).toMatchObject({ needsManualAssociation: true, proposal: null });
  });

  it("another member cannot link someone else's response", async () => {
    const id = await stored();
    await expect(linkResponse(m2, id, null)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("cannot link to another member's proposal", async () => {
    const id = await stored();
    const othersDraft = await submittedDraft(m2);
    await expect(linkResponse(m1, id, othersDraft)).rejects.toBeInstanceOf(ForbiddenError);
    expect(fake.db._responses.get(id)!.draftId).toBeNull();
  });

  it("only a submitted proposal can be linked", async () => {
    const id = await stored();
    const draft = await createDraft(
      m1,
      CreateDraftBody.parse({ jobUrl: "https://www.upwork.com/jobs/~022777777777777777777", jobTitle: "Still a draft", coverLetter: "x", proposedRate: "10" }),
    );
    await expect(linkResponse(m1, id, draft.id)).rejects.toMatchObject({ code: "not_submitted" });
    expect(fake.db._responses.get(id)!.draftId).toBeNull();
  });

  it("unlinking the only interview puts the dashboard proposal back to Submitted", async () => {
    const id = await stored();
    const draftId = await submittedDraft();
    await linkResponse(m1, id, draftId);
    expect([...fake.db._proposals.values()][0].section).toBe("Interviewing");
    await linkResponse(m1, id, null);
    expect([...fake.db._proposals.values()][0].section).toBe("Submitted");
  });

  it("unknown response or proposal → not_found", async () => {
    const id = await stored();
    await expect(linkResponse(m1, "nope", null)).rejects.toBeInstanceOf(DraftError);
    await expect(linkResponse(m1, id, "nope")).rejects.toBeInstanceOf(DraftError);
  });
});
