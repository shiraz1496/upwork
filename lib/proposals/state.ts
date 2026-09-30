// Proposal state machine (handover §9). Pure logic — no DB, no I/O.
//
//   DRAFT ──ready──► READY ──confirm──► SUBMISSION_UNVERIFIED ──MCP verify──► SUBMITTED_CONFIRMED
//     ▲                │
//     └──── edit ◄─────┘
//
// - confirm = the developer says "I submitted this on upwork.com" (self-reported).
// - SUBMITTED_CONFIRMED is reachable ONLY when an official MCP tool shows the submission.
// - The app never submits anything to Upwork.

import type { ProposalState, Provenance } from "@prisma/client";

export type DraftSnapshot = {
  state: ProposalState;
  coverLetter: string;
  bidType: string;
  proposedRate: string | null;
  fixedBidAmount: string | null;
};

const ALLOWED: Record<ProposalState, ProposalState[]> = {
  DRAFT: ["READY"],
  READY: ["DRAFT", "SUBMISSION_UNVERIFIED"],
  SUBMISSION_UNVERIFIED: ["SUBMITTED_CONFIRMED"],
  SUBMITTED_CONFIRMED: [],
};

export function canTransition(from: ProposalState, to: ProposalState): boolean {
  return ALLOWED[from].includes(to);
}

export class InvalidTransition extends Error {
  constructor(
    readonly from: ProposalState,
    readonly to: ProposalState,
    readonly reason: string,
  ) {
    super(`Cannot move proposal from ${from} to ${to}: ${reason}`);
  }
}

// Content can only be edited while it is still a draft.
export function isEditable(state: ProposalState): boolean {
  return state === "DRAFT";
}

// Deleting is allowed only before a submission was recorded (keeps the audit trail).
export function isDeletable(state: ProposalState): boolean {
  return state === "DRAFT" || state === "READY";
}

export function bidAmount(d: Pick<DraftSnapshot, "bidType" | "proposedRate" | "fixedBidAmount">): string | null {
  return d.bidType === "fixed" ? d.fixedBidAmount : d.proposedRate;
}

// What is missing before a draft can be marked READY.
export function readinessIssues(d: DraftSnapshot): string[] {
  const issues: string[] = [];
  if (d.coverLetter.trim().length === 0) issues.push("coverLetter is empty");
  if (d.bidType !== "hourly" && d.bidType !== "fixed") issues.push("bidType must be hourly or fixed");
  if (!bidAmount(d)) issues.push(d.bidType === "fixed" ? "fixedBidAmount is required" : "proposedRate is required");
  return issues;
}

export type TransitionResult = {
  update: {
    state: ProposalState;
    readyAt?: Date | null;
    submissionConfirmedAt?: Date;
    submittedCoverLetter?: string;
    submittedBidAmount?: string | null;
    submissionProvenance?: Provenance;
  };
  event: { actorId: string; fromState: ProposalState; toState: ProposalState; note: string | null };
};

export function applyTransition(
  draft: DraftSnapshot,
  to: ProposalState,
  actorId: string,
  opts: { note?: string; mcpVerified?: boolean; now?: Date } = {},
): TransitionResult {
  const from = draft.state;
  if (!canTransition(from, to)) throw new InvalidTransition(from, to, "transition not allowed");
  const now = opts.now ?? new Date();
  const event = { actorId, fromState: from, toState: to, note: opts.note ?? null };

  switch (to) {
    case "READY": {
      const issues = readinessIssues(draft);
      if (issues.length) throw new InvalidTransition(from, to, issues.join("; "));
      return { update: { state: to, readyAt: now }, event };
    }
    case "DRAFT":
      return { update: { state: to, readyAt: null }, event };
    case "SUBMISSION_UNVERIFIED":
      // Self-reported: snapshot exactly what the developer says they sent.
      return {
        update: {
          state: to,
          submissionConfirmedAt: now,
          submittedCoverLetter: draft.coverLetter,
          submittedBidAmount: bidAmount(draft),
          submissionProvenance: "DEVELOPER_CONFIRMED",
        },
        event,
      };
    case "SUBMITTED_CONFIRMED":
      if (!opts.mcpVerified) {
        throw new InvalidTransition(from, to, "needs verification by an official Upwork MCP tool");
      }
      return { update: { state: to, submissionProvenance: "MCP_VERIFIED" }, event };
  }
}
