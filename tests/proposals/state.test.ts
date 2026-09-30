import { describe, expect, it } from "vitest";
import type { ProposalState } from "@prisma/client";
import {
  applyTransition,
  canTransition,
  InvalidTransition,
  isDeletable,
  isEditable,
  readinessIssues,
  type DraftSnapshot,
} from "@/lib/proposals/state";

const STATES: ProposalState[] = ["DRAFT", "READY", "SUBMISSION_UNVERIFIED", "SUBMITTED_CONFIRMED"];
const draft = (over: Partial<DraftSnapshot> = {}): DraftSnapshot => ({
  state: "DRAFT",
  coverLetter: "Hello, I can help with this.",
  bidType: "hourly",
  proposedRate: "25",
  fixedBidAmount: null,
  ...over,
});

describe("canTransition", () => {
  const allowed = new Set(["DRAFT>READY", "READY>DRAFT", "READY>SUBMISSION_UNVERIFIED", "SUBMISSION_UNVERIFIED>SUBMITTED_CONFIRMED"]);
  for (const from of STATES) {
    for (const to of STATES) {
      const ok = allowed.has(`${from}>${to}`);
      it(`${from} → ${to} is ${ok ? "allowed" : "refused"}`, () => {
        expect(canTransition(from, to)).toBe(ok);
      });
    }
  }
});

describe("applyTransition", () => {
  const now = new Date("2026-09-30T10:00:00Z");

  it("DRAFT → READY stamps readyAt and writes an event", () => {
    const r = applyTransition(draft(), "READY", "m1", { now });
    expect(r.update).toEqual({ state: "READY", readyAt: now });
    expect(r.event).toEqual({ actorId: "m1", fromState: "DRAFT", toState: "READY", note: null });
  });

  it("DRAFT → READY is refused while the draft is incomplete", () => {
    expect(() => applyTransition(draft({ coverLetter: "  " }), "READY", "m1")).toThrow(/coverLetter is empty/);
    expect(() => applyTransition(draft({ proposedRate: null }), "READY", "m1")).toThrow(/proposedRate is required/);
    expect(() => applyTransition(draft({ bidType: "fixed" }), "READY", "m1")).toThrow(/fixedBidAmount is required/);
  });

  it("READY → DRAFT (edit-back) clears readyAt", () => {
    expect(applyTransition(draft({ state: "READY" }), "DRAFT", "m1").update).toEqual({ state: "DRAFT", readyAt: null });
  });

  it("confirm: READY → SUBMISSION_UNVERIFIED snapshots what was sent, as DEVELOPER_CONFIRMED", () => {
    const r = applyTransition(draft({ state: "READY" }), "SUBMISSION_UNVERIFIED", "m1", { now, note: "sent" });
    expect(r.update).toEqual({
      state: "SUBMISSION_UNVERIFIED",
      submissionConfirmedAt: now,
      submittedCoverLetter: "Hello, I can help with this.",
      submittedBidAmount: "25",
      submissionProvenance: "DEVELOPER_CONFIRMED",
    });
    expect(r.event.note).toBe("sent");
  });

  it("snapshots the fixed amount for fixed bids", () => {
    const r = applyTransition(draft({ state: "READY", bidType: "fixed", fixedBidAmount: "500", proposedRate: "25" }), "SUBMISSION_UNVERIFIED", "m1");
    expect(r.update.submittedBidAmount).toBe("500");
  });

  it("a saved draft can never jump straight to submitted", () => {
    expect(() => applyTransition(draft(), "SUBMISSION_UNVERIFIED", "m1")).toThrow(InvalidTransition);
    expect(() => applyTransition(draft(), "SUBMITTED_CONFIRMED", "m1", { mcpVerified: true })).toThrow(InvalidTransition);
    expect(() => applyTransition(draft({ state: "READY" }), "SUBMITTED_CONFIRMED", "m1", { mcpVerified: true })).toThrow(InvalidTransition);
  });

  it("SUBMITTED_CONFIRMED needs MCP verification — a self-report is not enough", () => {
    const d = draft({ state: "SUBMISSION_UNVERIFIED" });
    expect(() => applyTransition(d, "SUBMITTED_CONFIRMED", "m1")).toThrow(/official Upwork MCP tool/);
    expect(applyTransition(d, "SUBMITTED_CONFIRMED", "m1", { mcpVerified: true }).update).toEqual({
      state: "SUBMITTED_CONFIRMED",
      submissionProvenance: "MCP_VERIFIED",
    });
  });

  it("nothing leaves SUBMITTED_CONFIRMED", () => {
    for (const to of STATES) {
      expect(() => applyTransition(draft({ state: "SUBMITTED_CONFIRMED" }), to, "m1", { mcpVerified: true })).toThrow(InvalidTransition);
    }
  });
});

describe("edit / delete rules", () => {
  it("only DRAFT is editable; only DRAFT and READY are deletable", () => {
    expect(STATES.filter(isEditable)).toEqual(["DRAFT"]);
    expect(STATES.filter(isDeletable)).toEqual(["DRAFT", "READY"]);
  });
  it("a complete draft has no readiness issues", () => {
    expect(readinessIssues(draft())).toEqual([]);
  });
});
