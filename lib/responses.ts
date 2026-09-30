// Client responses (handover Phase F): rooms where the CLIENT wrote last, read from the
// developer's own Upwork connection on request ("Refresh activity" — never on a schedule).
//
// A response is linked to a proposal only through a verified Upwork identifier (the room_id
// Upwork itself returns in that proposal's detail). Otherwise it is stored unlinked with
// associationMethod "manual" and the developer links it by hand. Nothing is ever matched
// by client name or job title.

import type { ClientResponse } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertOwns } from "@/lib/me-auth";
import {
  feedAlertFromResponse,
  markProposalInterviewing,
  memberAccount,
  resolveAlertsForRooms,
  unmarkProposalInterviewing,
} from "@/lib/dashboard-feed";
import { DraftError } from "@/lib/proposals/drafts";
import { mcpDataExpiry } from "@/lib/retention";
import type { ConnectionDeps } from "@/lib/upwork/connection";
import { UpworkError } from "@/lib/upwork/errors";
import { jobIdKey } from "@/lib/upwork/ids";
import { listRooms } from "@/lib/upwork/messages";
import { proposalsForJobs } from "@/lib/upwork/proposals";

type Member = { id: string; name: string };

// A reply older than this is not picked up as a new client response.
const RECENT_REPLY_DAYS = 30;

export type SyncResult =
  | { status: "disabled" }
  // Mock (local dev) data is shown but never stored as if it came from Upwork.
  | { status: "ok"; provenance: "MOCK"; stored: 0; clientRooms: number }
  | { status: "ok"; provenance: "MCP_VERIFIED"; stored: number; linked: number; needManualLink: number; clientRooms: number; linkingAvailable: boolean };

export async function syncClientResponses(member: Member, deps?: ConnectionDeps): Promise<SyncResult> {
  const rooms = await listRooms(member.id, { limit: 50 }, deps);
  if (rooms.status === "disabled") return { status: "disabled" };

  // Only rooms where we KNOW the other side wrote last count as a client response — and
  // only recent ones, so the first refresh does not turn every old chat into an alert.
  const recentSince = Date.now() - RECENT_REPLY_DAYS * 24 * 60 * 60 * 1000;
  const clientRooms = rooms.data.filter(
    (r) =>
      r.lastMessageFromSelf === false &&
      r.upworkMessageId &&
      r.lastMessageAt !== null &&
      new Date(r.lastMessageAt).getTime() >= recentSince,
  );
  if (rooms.provenance !== "MCP_VERIFIED") {
    return { status: "ok", provenance: "MOCK", stored: 0, clientRooms: clientRooms.length };
  }

  // Rooms where the bidder has since answered: their dashboard alerts are resolved.
  await resolveAlertsForRooms(
    member.id,
    rooms.data.filter((r) => r.lastMessageFromSelf === true).map((r) => r.upworkThreadId),
  );

  // Verified links: job → room, for the member's own recorded submissions.
  const drafts = await prisma.proposalDraft.findMany({
    where: { memberId: member.id, state: { in: ["SUBMISSION_UNVERIFIED", "SUBMITTED_CONFIRMED"] } },
    select: { id: true, upworkJobId: true, jobTitle: true },
  });
  const draftByRoom = new Map<string, string>();
  let linkingAvailable = true;
  // Interview rooms count whoever wrote last: the client opened an interview even if the
  // bidder has already answered it.
  const interviewRooms = rooms.data.filter((r) => r.kind === "interview");
  if ((clientRooms.length > 0 || interviewRooms.length > 0) && drafts.length > 0) {
    try {
      const links = await proposalsForJobs(member.id, drafts.map((d) => jobIdKey(d.upworkJobId)), { withRooms: true }, deps);
      if (links.status === "ok") {
        for (const d of drafts) {
          const roomId = links.data.get(jobIdKey(d.upworkJobId))?.roomId;
          if (roomId) draftByRoom.set(roomId, d.id);
        }
      }
    } catch (err) {
      // Linking is best effort; the responses are still stored, just unlinked.
      if (!(err instanceof UpworkError)) throw err;
      linkingAvailable = false;
    }
  }

  let stored = 0;
  let linked = 0;
  let accountId: string | null = null;
  for (const room of clientRooms) {
    const draftId = draftByRoom.get(room.upworkThreadId) ?? null;
    const exists = await prisma.clientResponse.findFirst({
      where: { memberId: member.id, upworkThreadId: room.upworkThreadId, upworkMessageId: room.upworkMessageId },
      select: { id: true, draftId: true },
    });
    if (exists) {
      // Stored earlier without a link (the proposal was recorded later, or the lookup
      // failed that time): link it now that Upwork gives us the verified room.
      if (exists.draftId === null && draftId) {
        await prisma.clientResponse.update({
          where: { id: exists.id },
          data: { draftId, associationMethod: "verified_identifier" },
        });
        linked++;
        if (room.kind === "interview") await markProposalInterviewing(draftId);
      }
      continue;
    }
    await prisma.clientResponse.create({
      data: {
        memberId: member.id,
        draftId,
        upworkThreadId: room.upworkThreadId,
        upworkMessageId: room.upworkMessageId,
        kind: room.kind,
        snippet: room.snippet,
        receivedAt: room.lastMessageAt ? new Date(room.lastMessageAt) : null,
        provenance: "MCP_VERIFIED",
        associationMethod: draftId ? "verified_identifier" : "manual",
        expiresAt: mcpDataExpiry(),
      },
    });
    stored++;
    if (draftId) linked++;

    // Dashboard feed: an alert (no message text) and, for a linked interview, the proposal row.
    accountId ??= (await memberAccount(member)).id;
    await feedAlertFromResponse({
      member,
      accountId,
      roomId: room.upworkThreadId,
      kind: room.kind,
      receivedAt: room.lastMessageAt ? new Date(room.lastMessageAt) : null,
      jobTitle: drafts.find((d) => d.id === draftId)?.jobTitle ?? null,
    });
    if (draftId && room.kind === "interview") await markProposalInterviewing(draftId);
  }
  // Every interview room Upwork links to a recorded proposal marks it as interviewed —
  // including rooms skipped above because the bidder wrote last (no pending reply there).
  for (const room of interviewRooms) {
    const draftId = draftByRoom.get(room.upworkThreadId);
    if (draftId) await markProposalInterviewing(draftId);
  }
  return {
    status: "ok",
    provenance: "MCP_VERIFIED",
    stored,
    linked,
    needManualLink: stored - linked,
    clientRooms: clientRooms.length,
    linkingAvailable,
  };
}

type ResponseWithDraft = ClientResponse & { draft?: { id: string; jobTitle: string } | null };

export function serializeResponse(r: ResponseWithDraft) {
  return {
    id: r.id,
    kind: r.kind,
    snippet: r.snippet,
    receivedAt: r.receivedAt,
    provenance: r.provenance,
    associationMethod: r.associationMethod,
    needsManualAssociation: r.draftId === null,
    proposal: r.draft ? { id: r.draft.id, jobTitle: r.draft.jobTitle } : null,
    createdAt: r.createdAt,
  };
}

export function listResponses(member: Member) {
  return prisma.clientResponse.findMany({
    where: { memberId: member.id },
    orderBy: [{ receivedAt: "desc" }, { createdAt: "desc" }],
    take: 200,
    include: { draft: { select: { id: true, jobTitle: true } } },
  });
}

// Manual association by the developer (or unlink with draftId = null). Both the response
// and the proposal must belong to the session member.
export async function linkResponse(member: Member, responseId: string, draftId: string | null) {
  const response = await prisma.clientResponse.findUnique({ where: { id: responseId } });
  if (!response) throw new DraftError("not_found", 404, "Response not found");
  assertOwns(member, response.memberId);

  if (draftId) {
    const draft = await prisma.proposalDraft.findUnique({ where: { id: draftId } });
    if (!draft) throw new DraftError("not_found", 404, "Proposal not found");
    assertOwns(member, draft.memberId);
    // A client can only have replied to a proposal that was actually sent.
    if (draft.state !== "SUBMISSION_UNVERIFIED" && draft.state !== "SUBMITTED_CONFIRMED") {
      throw new DraftError("not_submitted", 409, "Only a submitted proposal can be linked to a client reply");
    }
  }
  const updated = await prisma.clientResponse.update({
    where: { id: responseId },
    data: { draftId, associationMethod: "manual" },
    include: { draft: { select: { id: true, jobTitle: true } } },
  });
  if (response.kind === "interview") {
    if (draftId) await markProposalInterviewing(draftId);
    // The proposal it was linked to before may no longer have any interview.
    if (response.draftId && response.draftId !== draftId) await unmarkProposalInterviewing(response.draftId);
  }
  return updated;
}
