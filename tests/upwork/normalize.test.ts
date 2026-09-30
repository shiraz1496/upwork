import { describe, expect, it } from "vitest";
import { McpProtocolError } from "@/lib/upwork/errors";
import { normalizeJobs, normalizeProposalDetail, normalizeProposals, parseBudget, toolPayload, untrusted } from "@/lib/upwork/normalize";

describe("parseBudget (budget text as the live server sends it)", () => {
  it.each([
    ["100.00", { min: 100, max: 100 }],
    ["15.00–20.00/hr", { min: 15, max: 20 }],
    ["25.00+/hr", { min: 25, max: null }],
    ["up to 40.00/hr", { min: null, max: 40 }],
    ["1,500.00", { min: 1500, max: 1500 }],
    [undefined, { min: null, max: null }],
    ["no rate stated", { min: null, max: null }],
  ])("%s", (input, expected) => {
    expect(parseBudget(input)).toEqual(expected);
  });
});

describe("untrusted text", () => {
  it("strips the wrapper tags and keeps the text", () => {
    expect(untrusted("<untrusted_participant_content>\nHello there\n</untrusted_participant_content>")).toBe("Hello there");
    expect(untrusted(undefined)).toBeNull();
  });
});

describe("toolPayload", () => {
  it("parses the JSON text block", () => {
    expect(toolPayload({ content: [{ type: "text", text: '{"status":"ok","jobs":[]}' }] })).toEqual({ status: "ok", jobs: [] });
  });
  it("throws when the tool reports a non-ok status", () => {
    expect(() => toolPayload({ content: [{ type: "text", text: '{"status":"error","message":"x"}' }] })).toThrow(McpProtocolError);
  });
});

describe("proposals (live-server shape)", () => {
  const node = {
    id: "2085416267532898380",
    boosted: false,
    status: { status: "Archived", status_label: "Archived (job closed)", reason: { id: "51", reason: "All positions filled" } },
    marketplaceJobPosting: { id: "2084672231134301765", content: { title: "Some job title" }, url: "https://www.upwork.com/jobs/~022084672231134301765?utm_source=claude" },
    auditDetails: {
      createdDateTime: { displayValue: "2026-09-07T14:26:03.250Z", rawValue: "1788791163250" },
      modifiedDateTime: { displayValue: "2026-09-15T19:31:07.506Z", rawValue: "1789500667506" },
    },
  };

  it("normalizeProposals reads status, job and both dates from a list row", () => {
    expect(normalizeProposals({ data: { vendorProposals: { edges: [{ node }, { node: {} }] } } })).toEqual([
      {
        upworkProposalId: "2085416267532898380",
        status: "Archived",
        statusLabel: "Archived (job closed)",
        upworkJobId: "2084672231134301765",
        jobTitle: "Some job title",
        createdAt: "2026-09-07T14:26:03.250Z",
        modifiedAt: "2026-09-15T19:31:07.506Z",
      },
    ]);
  });

  it("falls back to the epoch-ms rawValue when displayValue is missing", () => {
    const n = { ...node, auditDetails: { createdDateTime: { rawValue: "1788791163250" } } };
    const [p] = normalizeProposals({ data: { vendorProposals: { edges: [{ node: n }] } } });
    expect(p.createdAt).toBe("2026-09-07T14:26:03.250Z");
    expect(p.modifiedAt).toBeNull();
  });

  it("normalizeProposalDetail returns the proposal and its verified room id", () => {
    const d = normalizeProposalDetail({ status: "ok", data: { vendorProposal: node }, room_id: "room_abc", plan: "Freelancer Basic" });
    expect(d.roomId).toBe("room_abc");
    expect(d.proposal?.upworkJobId).toBe("2084672231134301765");
  });

  it("no room_id → null (no verified link)", () => {
    expect(normalizeProposalDetail({ status: "ok", data: { vendorProposal: node } }).roomId).toBeNull();
    expect(normalizeProposalDetail({}).proposal).toBeNull();
  });
});

describe("numbers from Upwork", () => {
  const job = (client: Record<string, unknown>) => normalizeJobs({ jobs: [{ id: "1", title: "T", client }] })[0].client;

  it("a blank or unreadable value is unknown (null), never 0", () => {
    expect(job({ rating: "", total_spent: "  ", total_posted_jobs: "n/a" })).toMatchObject({ rating: null, totalSpent: null, totalPostedJobs: null });
    expect(job({})).toMatchObject({ rating: null, totalSpent: null, totalPostedJobs: null });
  });
  it("a real zero stays zero", () => {
    expect(job({ rating: 0, total_spent: "$0.00" })).toMatchObject({ rating: 0, totalSpent: 0 });
  });
  it("reads money with separators and K/M/B", () => {
    expect(job({ total_spent: "$7,233.56" }).totalSpent).toBe(7233.56);
    expect(job({ total_spent: "$10K+" }).totalSpent).toBe(10000);
    expect(job({ total_spent: "$1.5M" }).totalSpent).toBe(1500000);
  });
});
