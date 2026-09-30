// Feeds the tables the existing dashboards render (Account, Proposal, Alert) from the new
// pipeline (handover Phase G), so the admin and developer screens keep working unchanged:
// coaching notes, nudges, team stats and the duplicate checker all hang off Proposal rows.
//
// What goes in:
//   Proposal ← a ProposalDraft once its submission is recorded (developer-authored content)
//   Alert    ← a stored ClientResponse (NO message text — that stays in ClientResponse,
//              which expires; see lib/retention.ts)
//   Account  ← one per bidder: a placeholder until they connect Upwork, then the real account

import type { ProposalDraft } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { ConnectionDeps } from "@/lib/upwork/connection";
import type { ProposalDto } from "@/lib/upwork/normalize";
import { getOwnProfile } from "@/lib/upwork/profile";
import { mcpEnabled } from "@/lib/upwork/flags";
import { isMockOrgUid } from "@/lib/upwork/ids";
import { logError } from "@/lib/log";

type Member = { id: string; name: string };

const placeholderId = (memberId: string) => `member:${memberId}`;

export function isPlaceholderAccount(freelancerId: string): boolean {
  return freelancerId.startsWith("member:");
}

// The bidder's own account. Connected → the Account for their Upwork org_uid (adopting the
// placeholder on first connect so earlier proposals stay attached). Not connected → a
// placeholder Account, so proposals tracked before Upwork approval still show on dashboards.
// A test-mode (made-up) identity never becomes an account: it stays a placeholder.
export async function memberAccount(member: Member) {
  const conn = await prisma.upworkConnection.findUnique({
    where: { memberId: member.id },
    select: { upworkAccountId: true, accountName: true },
  });
  const placeholderFid = placeholderId(member.id);
  const orgUid = conn?.upworkAccountId && !isMockOrgUid(conn.upworkAccountId) ? conn.upworkAccountId : null;

  if (!orgUid) {
    // upsert on the unique freelancerId: two requests at once cannot create two.
    return prisma.account.upsert({
      where: { freelancerId: placeholderFid },
      create: { freelancerId: placeholderFid, name: `${member.name} (Upwork not connected)` },
      update: {},
    });
  }

  const name = conn?.accountName ?? member.name;
  const placeholder = await prisma.account.findUnique({ where: { freelancerId: placeholderFid } });
  const real = await prisma.account.findUnique({ where: { freelancerId: orgUid } });
  if (!real) {
    try {
      if (placeholder) {
        return await prisma.account.update({ where: { id: placeholder.id }, data: { freelancerId: orgUid, name } });
      }
      return await prisma.account.create({ data: { freelancerId: orgUid, name } });
    } catch (err) {
      // Another request of the same member got there first.
      const now = await prisma.account.findUnique({ where: { freelancerId: orgUid } });
      if (now) return now;
      throw err;
    }
  }
  if (placeholder) {
    // Both exist: move what the placeholder collected onto the real account.
    try {
      await prisma.$transaction([
        prisma.proposalDraft.updateMany({ where: { accountId: placeholder.id }, data: { accountId: real.id } }),
        prisma.proposal.updateMany({ where: { accountId: placeholder.id }, data: { accountId: real.id } }),
        prisma.alert.updateMany({ where: { accountId: placeholder.id }, data: { accountId: real.id } }),
        prisma.accountKeyword.updateMany({ where: { accountId: placeholder.id }, data: { accountId: real.id } }),
        prisma.account.delete({ where: { id: placeholder.id } }),
      ]);
    } catch (err) {
      // A concurrent merge, or a row that still points at the placeholder. Nothing is lost:
      // the transaction rolled back and the merge is attempted again next time.
      logError("account merge", err);
    }
  }
  return real;
}

// The dashboard row for a draft: same account, same job link, and sent by the same bidder
// — never another member's row that happens to share the account and link.
function findProposalRow(draft: Pick<ProposalDraft, "accountId" | "jobUrl" | "memberId">) {
  if (!draft.accountId) return Promise.resolve(null);
  return prisma.proposal.findFirst({
    where: { accountId: draft.accountId, jobUrl: draft.jobUrl, capturedByUserId: draft.memberId },
  });
}

// Creates the dashboard row if it is missing; changes nothing if it exists.
export async function ensureProposalRow(draft: ProposalDraft) {
  if (draft.state !== "SUBMISSION_UNVERIFIED" && draft.state !== "SUBMITTED_CONFIRMED") return;
  if (!(await findProposalRow(draft))) await feedProposalFromDraft(draft);
}

function proposalStatus(d: ProposalDraft): string {
  return d.state === "SUBMITTED_CONFIRMED" ? "Submitted (verified by Upwork)" : "Submitted (self-reported)";
}

// Write/update the dashboard Proposal for a draft whose submission was recorded.
// Matched by account + job URL, the same key the old proposals sync used.
export async function feedProposalFromDraft(draft: ProposalDraft) {
  if (draft.state !== "SUBMISSION_UNVERIFIED" && draft.state !== "SUBMITTED_CONFIRMED") return null;
  if (!draft.accountId) return null;

  const existing = await findProposalRow(draft);
  const data = {
    jobTitle: draft.jobTitle,
    jobUrl: draft.jobUrl,
    status: proposalStatus(draft),
    coverLetter: draft.submittedCoverLetter ?? draft.coverLetter,
    proposedRate: draft.submittedBidAmount,
    submittedAt: draft.submissionConfirmedAt,
  };
  if (existing) {
    // Once Upwork reported an outcome (offer, hired, closed…), keep that status.
    const keepStatus = existing.status !== null && !existing.status.startsWith("Submitted");
    return prisma.proposal.update({ where: { id: existing.id }, data: keepStatus ? { ...data, status: existing.status } : data });
  }
  return prisma.proposal.create({
    data: {
      ...data,
      accountId: draft.accountId,
      section: "Submitted",
      submittedViaExtension: false,
      capturedByUserId: draft.memberId,
      submittedByUserId: draft.memberId,
      capturedAt: new Date(),
    },
  });
}

// A client interview on a proposal (linked by verified identifier or by the developer) moves
// its dashboard row to "Interviewing", which is what the Overview counts as interviewed.
export async function markProposalInterviewing(draftId: string) {
  const draft = await prisma.proposalDraft.findUnique({ where: { id: draftId } });
  if (!draft?.accountId) return;
  await prisma.proposal.updateMany({
    where: { accountId: draft.accountId, jobUrl: draft.jobUrl, capturedByUserId: draft.memberId, section: "Submitted" },
    data: { section: "Interviewing" },
  });
}

// The last linked interview was unlinked: the row goes back to "Submitted" (only if it is
// still at "Interviewing" — an offer or hire reported by Upwork is left alone).
export async function unmarkProposalInterviewing(draftId: string) {
  const draft = await prisma.proposalDraft.findUnique({ where: { id: draftId } });
  if (!draft?.accountId) return;
  const stillLinked = await prisma.clientResponse.count({ where: { draftId, kind: "interview" } });
  if (stillLinked > 0) return;
  await prisma.proposal.updateMany({
    where: { accountId: draft.accountId, jobUrl: draft.jobUrl, capturedByUserId: draft.memberId, section: "Interviewing" },
    data: { section: "Submitted" },
  });
}

// One Alert per stored client response. Deliberately no preview/message text.
export async function feedAlertFromResponse(args: {
  member: Member;
  accountId: string;
  roomId: string;
  kind: string;
  receivedAt: Date | null;
  jobTitle: string | null;
}) {
  const isInterview = args.kind === "interview";
  return prisma.alert.create({
    data: {
      accountId: args.accountId,
      type: "message",
      title: isInterview ? "Client replied in an interview room" : "Client replied",
      roomId: args.roomId,
      jobTitle: args.jobTitle,
      date: args.receivedAt?.toISOString() ?? null,
      freelancerReplied: false,
      needsAttention: true,
      isUnread: true,
      capturedByUserId: args.member.id,
      capturedAt: new Date(),
    },
  });
}

// The bidder answered in these rooms: their alerts no longer need attention.
export async function resolveAlertsForRooms(memberId: string, roomIds: string[]) {
  if (roomIds.length === 0) return;
  await prisma.alert.updateMany({
    where: { capturedByUserId: memberId, roomId: { in: roomIds }, freelancerReplied: false },
    data: { freelancerReplied: true, needsAttention: false, isUnread: false },
  });
}

// Metrics with no data source for proposals recorded through the new pipeline. The
// dashboards show these as unavailable instead of 0.
//   viewed — Upwork does not report whether the client viewed a given proposal (verified
//            2026-09-30: the proposal detail has no such field; "insights" are a paid
//            Freelancer Plus feature and are job-level counts, not per proposal).
//   hired  — Upwork DOES report it (proposal status Hired), but it only reaches us when
//            that bidder's own connection is live and has been refreshed at least once.
export function unavailableMetrics(hiredKnown: boolean): string[] {
  return hiredKnown ? ["viewed"] : ["viewed", "hired"];
}

// Upwork org_uids whose "hired" number has a real source: the integration is on and the
// connection for that account is connected and has been refreshed. (Test mode never feeds
// hired, so it never counts.)
export async function upworkIdsWithHiredSource(freelancerIds: string[]): Promise<Set<string>> {
  if (!mcpEnabled() || freelancerIds.length === 0) return new Set();
  const rows = await prisma.upworkConnection.findMany({
    where: { status: "connected", lastSyncedAt: { not: null }, upworkAccountId: { in: freelancerIds } },
    select: { upworkAccountId: true },
  });
  return new Set(rows.map((r) => r.upworkAccountId).filter((id): id is string => id !== null));
}

// What Upwork says happened to a submitted proposal → the dashboard Proposal row.
// Hired sets hiredAt (the Overview's "hired"); Offered moves it to the Offers section.
export async function applyProposalOutcome(draft: ProposalDraft, found: ProposalDto) {
  if (!draft.accountId) return;
  const row = await findProposalRow(draft);
  if (!row) return;

  const verified = (text: string) => `${text} (verified by Upwork)`;
  let data: { status: string; section?: string; hiredAt?: Date };
  switch (found.status) {
    case "Hired":
      data = { status: verified("Hired"), section: "Active" };
      if (!row.hiredAt) data.hiredAt = found.modifiedAt ? new Date(found.modifiedAt) : new Date();
      break;
    case "Offered":
      data = { status: verified("Offer received"), section: "Offers" };
      break;
    case "Declined":
    case "Withdrawn":
    case "Archived":
      data = { status: verified(found.statusLabel ?? found.status) };
      break;
    default:
      return; // Accepted = submitted, nothing more to record
  }
  await prisma.proposal.update({ where: { id: row.id }, data });
}

export async function accountsWithNewPipelineData(accountIds?: string[]): Promise<Set<string>> {
  const rows = await prisma.proposalDraft.findMany({
    where: {
      state: { in: ["SUBMISSION_UNVERIFIED", "SUBMITTED_CONFIRMED"] },
      accountId: accountIds ? { in: accountIds } : { not: null },
    },
    select: { accountId: true },
    distinct: ["accountId"],
  });
  return new Set(rows.map((r) => r.accountId).filter((id): id is string => id !== null));
}

// job URL → how the submission is known, for the provenance badge on proposal rows.
export async function submissionProvenanceByJobUrl(where: { memberId?: string }) {
  const rows = await prisma.proposalDraft.findMany({
    where: { ...where, state: { in: ["SUBMISSION_UNVERIFIED", "SUBMITTED_CONFIRMED"] }, accountId: { not: null } },
    select: { accountId: true, jobUrl: true, submissionProvenance: true },
  });
  return new Map(rows.map((r) => [`${r.accountId}|${r.jobUrl}`, r.submissionProvenance]));
}

// Feed the bidder's Account (Connects balance) and FreelancerProfile from their own Upwork
// profile. User-triggered only. MCP-derived → refreshed/purged under lib/retention.ts.
// JSS is not returned by the tool, so it stays null (shown as unavailable, not 0).
export async function syncProfile(member: Member, deps?: ConnectionDeps) {
  const result = await getOwnProfile(member.id, deps);
  if (result.status === "disabled") return { status: "disabled" as const };
  // Mock (local dev) data is never stored as if it came from Upwork.
  if (result.provenance !== "MCP_VERIFIED") return { status: "ok" as const, provenance: "MOCK" as const, stored: false };

  const account = await memberAccount(member);
  const { profile, connectsBalance } = result.data;
  const fields = {
    title: profile.title,
    location: profile.location,
    hourlyRate: profile.hourlyRate,
    totalEarnings: profile.totalEarnings,
    totalJobs: profile.totalJobs,
    overview: profile.overview,
    skills: profile.skills,
  };
  await prisma.$transaction([
    prisma.account.update({ where: { id: account.id }, data: { connectsBalance } }),
    prisma.freelancerProfile.upsert({
      where: { accountId: account.id },
      create: { accountId: account.id, ...fields, capturedByUserId: member.id },
      update: { ...fields, capturedByUserId: member.id, capturedAt: new Date() },
    }),
  ]);
  return { status: "ok" as const, provenance: "MCP_VERIFIED" as const, stored: true };
}
