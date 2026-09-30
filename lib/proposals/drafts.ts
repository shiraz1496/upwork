// Proposal drafts: DB operations for the developer-facing routes (handover Phase E).
// Every function takes the session member and only ever touches that member's rows.
// Nothing here talks to Upwork except verifyDraft, which READS the member's own
// submitted-proposal list. The app never submits a proposal.

import { z } from "zod";
import type { ProposalDraft, ProposalState, ProposalStatusEvent } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertOwns } from "@/lib/me-auth";
import { applyProposalOutcome, ensureProposalRow, feedProposalFromDraft, memberAccount } from "@/lib/dashboard-feed";
import { applyTransition, isDeletable, isEditable, InvalidTransition } from "@/lib/proposals/state";
import { jobIdFromUrl, jobIdKey } from "@/lib/upwork/ids";
import { proposalsForJobs } from "@/lib/upwork/proposals";
import { markOutcomesRead, type ConnectionDeps } from "@/lib/upwork/connection";
import { logError } from "@/lib/log";

export class DraftError extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus: number,
    message: string,
  ) {
    super(message);
  }
}

const money = z
  .string()
  .trim()
  .regex(/^\d{1,7}(\.\d{1,2})?$/, "must be a number like 25 or 25.50")
  .refine((v) => Number(v) > 0, "must be more than 0");

// The job link is shown to the developer for manual submission — only real Upwork links.
const upworkUrl = z
  .string()
  .trim()
  .url()
  .refine((u) => {
    try {
      const { protocol, hostname } = new URL(u);
      return protocol === "https:" && (hostname === "upwork.com" || hostname.endsWith(".upwork.com"));
    } catch {
      return false;
    }
  }, "must be an https://www.upwork.com link")
  .refine((u) => jobIdFromUrl(u) !== null, "must be a link to an Upwork job (…/jobs/~02…)");

const fields = {
  upworkJobId: z.string().trim().min(1).max(64),
  jobUrl: upworkUrl,
  jobTitle: z.string().trim().min(1).max(300),
  coverLetter: z.string().max(20_000),
  bidType: z.enum(["hourly", "fixed"]),
  proposedRate: money.nullable(),
  fixedBidAmount: money.nullable(),
};

export const CreateDraftBody = z.object({
  // Optional and only cross-checked: the id that is stored always comes from the link.
  upworkJobId: fields.upworkJobId.optional(),
  jobUrl: fields.jobUrl,
  jobTitle: fields.jobTitle,
  coverLetter: fields.coverLetter.default(""),
  bidType: fields.bidType.default("hourly"),
  proposedRate: fields.proposedRate.optional(),
  fixedBidAmount: fields.fixedBidAmount.optional(),
});

export const UpdateDraftBody = z
  .object({
    jobUrl: fields.jobUrl,
    jobTitle: fields.jobTitle,
    coverLetter: fields.coverLetter,
    bidType: fields.bidType,
    proposedRate: fields.proposedRate,
    fixedBidAmount: fields.fixedBidAmount,
    // Only the two developer-driven moves; submission goes through /confirm.
    state: z.enum(["DRAFT", "READY"]),
  })
  .partial();

export const NoteBody = z.object({ note: z.string().trim().max(500).optional() });

type Member = { id: string; name: string };
type DraftWithEvents = ProposalDraft & { statusEvents?: ProposalStatusEvent[] };

export { jobIdKey };

export function serializeDraft(d: DraftWithEvents) {
  return {
    id: d.id,
    accountId: d.accountId,
    upworkJobId: d.upworkJobId,
    jobUrl: d.jobUrl,
    jobTitle: d.jobTitle,
    jobDataProvenance: d.jobDataProvenance,
    coverLetter: d.coverLetter,
    bidType: d.bidType,
    proposedRate: d.proposedRate,
    fixedBidAmount: d.fixedBidAmount,
    state: d.state,
    readyAt: d.readyAt,
    submissionConfirmedAt: d.submissionConfirmedAt,
    submittedCoverLetter: d.submittedCoverLetter,
    submittedBidAmount: d.submittedBidAmount,
    // DEVELOPER_CONFIRMED = self-reported; MCP_VERIFIED = seen in Upwork's own list.
    submissionProvenance: d.submissionProvenance,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    events: d.statusEvents?.map((e) => ({ fromState: e.fromState, toState: e.toState, note: e.note, at: e.at })),
  };
}

async function loadOwn(member: Member, id: string): Promise<ProposalDraft> {
  const draft = await prisma.proposalDraft.findUnique({ where: { id } });
  if (!draft) throw new DraftError("not_found", 404, "Proposal not found");
  assertOwns(member, draft.memberId);
  return draft;
}

function transitionError(err: unknown): never {
  if (err instanceof InvalidTransition) throw new DraftError("invalid_transition", 409, err.message);
  throw err;
}

// Every write names the state it expects (`where: { id, state }`). If another request
// changed the proposal in between, the database matches no row (P2025) and nothing is
// written — so two requests at once can never both succeed, and a recorded submission
// can never be edited, deleted or recorded twice.
async function guarded<T>(write: Promise<T>): Promise<T> {
  try {
    return await write;
  } catch (err) {
    if ((err as { code?: unknown } | null)?.code === "P2025") {
      throw new DraftError("conflict", 409, "This proposal was just changed by another request. Reload and try again.");
    }
    throw err;
  }
}

async function assertNoOtherDraftForJob(member: Member, jobKey: string, exceptId?: string) {
  const other = await prisma.proposalDraft.findFirst({
    where: { memberId: member.id, upworkJobId: jobKey, ...(exceptId && { id: { not: exceptId } }) },
    select: { id: true },
  });
  if (other) throw new DraftError("duplicate", 409, "You already have a proposal for this job");
}

export async function createDraft(member: Member, body: z.infer<typeof CreateDraftBody>) {
  // Always the bidder's own account (a placeholder until Upwork is connected) — never an
  // account id sent by the client.
  const accountId = (await memberAccount(member)).id;

  // The job id always comes from the link (the schema guarantees it has one).
  const key = jobIdFromUrl(body.jobUrl)!;
  if (body.upworkJobId && jobIdKey(body.upworkJobId) !== key) {
    throw new DraftError("job_mismatch", 400, "The job id does not match the job link");
  }
  await assertNoOtherDraftForJob(member, key);

  return prisma.proposalDraft.create({
    data: {
      memberId: member.id,
      accountId,
      upworkJobId: key,
      jobUrl: body.jobUrl,
      jobTitle: body.jobTitle,
      // Job details typed in by the developer are app-recorded, not MCP-verified.
      jobDataProvenance: "APP_RECORDED",
      coverLetter: body.coverLetter,
      bidType: body.bidType,
      proposedRate: body.proposedRate ?? null,
      fixedBidAmount: body.fixedBidAmount ?? null,
      statusEvents: { create: { actorId: member.id, fromState: null, toState: "DRAFT" } },
    },
    include: { statusEvents: { orderBy: { at: "asc" } } },
  });
}

export function listDrafts(member: Member, state?: ProposalState) {
  return prisma.proposalDraft.findMany({
    where: { memberId: member.id, ...(state && { state }) },
    orderBy: { updatedAt: "desc" },
    include: { statusEvents: { orderBy: { at: "asc" } } },
  });
}

async function transition(
  member: Member,
  draft: ProposalDraft,
  to: ProposalState,
  opts: { note?: string; mcpVerified?: boolean } = {},
  extra: Partial<ProposalDraft> = {},
) {
  let result;
  try {
    result = applyTransition({ ...draft, ...extra }, to, member.id, opts);
  } catch (err) {
    transitionError(err);
  }
  return guarded(
    prisma.proposalDraft.update({
      where: { id: draft.id, state: draft.state },
      data: { ...extra, ...result.update, statusEvents: { create: result.event } },
      include: { statusEvents: { orderBy: { at: "asc" } } },
    }),
  );
}

export async function updateDraft(member: Member, id: string, body: z.infer<typeof UpdateDraftBody>) {
  const draft = await loadOwn(member, id);
  const { state, ...fieldEdits } = body;
  const hasEdits = Object.keys(fieldEdits).length > 0;

  if (hasEdits && !isEditable(draft.state)) {
    throw new DraftError("not_editable", 409, `A ${draft.state} proposal cannot be edited; move it back to DRAFT first`);
  }

  // A new job link means a new job: the stored id follows the link, and the
  // one-proposal-per-job rule is checked again.
  const edits: typeof fieldEdits & { upworkJobId?: string } = { ...fieldEdits };
  if (fieldEdits.jobUrl !== undefined) {
    const key = jobIdFromUrl(fieldEdits.jobUrl)!;
    if (key !== draft.upworkJobId) {
      await assertNoOtherDraftForJob(member, key, draft.id);
      edits.upworkJobId = key;
    }
  }

  if (state && state !== draft.state) return transition(member, draft, state, {}, edits);
  if (!hasEdits) return prisma.proposalDraft.findUniqueOrThrow({ where: { id }, include: { statusEvents: { orderBy: { at: "asc" } } } });
  return guarded(
    prisma.proposalDraft.update({
      where: { id, state: draft.state },
      data: edits,
      include: { statusEvents: { orderBy: { at: "asc" } } },
    }),
  );
}

// The developer records "I submitted this on upwork.com". Self-reported → SUBMISSION_UNVERIFIED.
export async function confirmSubmission(member: Member, id: string, note?: string) {
  const draft = await loadOwn(member, id);
  // Older drafts may have no account yet; the dashboards need one to show the proposal.
  const extra = draft.accountId ? {} : { accountId: (await memberAccount(member)).id };
  const updated = await transition(member, draft, "SUBMISSION_UNVERIFIED", { note }, extra);
  // The submission is recorded at this point. If the dashboard copy fails, the bidder must
  // not be told the confirm failed (a retry would be refused): it is logged and repaired
  // the next time their proposals are listed (repairProposalRows).
  try {
    await feedProposalFromDraft(updated);
  } catch (err) {
    logError("proposal feed", err);
  }
  return updated;
}

export async function deleteDraft(member: Member, id: string) {
  const draft = await loadOwn(member, id);
  if (!isDeletable(draft.state)) {
    throw new DraftError("not_deletable", 409, "A proposal with a recorded submission cannot be deleted");
  }
  await guarded(prisma.proposalDraft.delete({ where: { id, state: draft.state } }));
}

// User-triggered check against Upwork's own list of the member's proposals. Promotes to
// SUBMITTED_CONFIRMED only on an exact job-id match. Flag off → nothing changes.
export async function verifySubmission(member: Member, id: string, deps?: ConnectionDeps) {
  const draft = await loadOwn(member, id);
  if (draft.state !== "SUBMISSION_UNVERIFIED") {
    throw new DraftError("invalid_transition", 409, "Only a proposal with a recorded submission can be verified");
  }
  const key = jobIdKey(draft.upworkJobId);
  const result = await proposalsForJobs(member.id, [key], {}, deps);
  if (result.status === "disabled") return { verification: "disabled" as const, draft };
  // Mock (local dev) data must never promote a proposal to MCP-verified.
  if (result.provenance !== "MCP_VERIFIED") return { verification: "not_found" as const, draft };

  const match = result.data.get(key);
  if (!match) return { verification: "not_found" as const, draft };

  const updated = await promote(member, draft, match.proposal.upworkProposalId);
  await applyProposalOutcome(updated, match.proposal);
  return { verification: "verified" as const, draft: updated };
}

async function promote(member: Member, draft: ProposalDraft, upworkProposalId: string) {
  const updated = await transition(member, draft, "SUBMITTED_CONFIRMED", {
    mcpVerified: true,
    note: `Verified via Upwork MCP (proposal ${upworkProposalId})`,
  });
  await feedProposalFromDraft(updated);
  return updated;
}

// Part of "Refresh activity": for every submission the member recorded, read what Upwork
// says about it — confirm it exists (→ SUBMITTED_CONFIRMED) and record its outcome
// (offer received, hired, declined…). Read only; mock data changes nothing.
export async function syncProposalOutcomes(member: Member, deps?: ConnectionDeps) {
  const drafts = await prisma.proposalDraft.findMany({
    where: { memberId: member.id, state: { in: ["SUBMISSION_UNVERIFIED", "SUBMITTED_CONFIRMED"] } },
  });
  const result = await proposalsForJobs(member.id, drafts.map((d) => jobIdKey(d.upworkJobId)), {}, deps);
  if (result.status === "disabled") return { status: "disabled" as const };
  await markOutcomesRead(member.id);
  if (result.provenance !== "MCP_VERIFIED") return { status: "ok" as const, provenance: "MOCK" as const, verified: 0, found: 0 };

  let verified = 0;
  let found = 0;
  for (const d of drafts) {
    // Repairs a dashboard row that is missing (e.g. the feed failed right after a confirm).
    await ensureProposalRow(d);
    const match = result.data.get(jobIdKey(d.upworkJobId));
    if (!match) continue;
    found++;
    let current = d;
    if (d.state === "SUBMISSION_UNVERIFIED") {
      current = await promote(member, d, match.proposal.upworkProposalId);
      verified++;
    }
    await applyProposalOutcome(current, match.proposal);
  }
  return { status: "ok" as const, provenance: "MCP_VERIFIED" as const, verified, found };
}
