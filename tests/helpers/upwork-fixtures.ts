// Fixtures for list_freelancer_proposals in the shape the live server returns
// (verified 2026-09-30). The data is made up.

export type FakeProposal = { id: string; jobId: string; status: string; title?: string; roomId?: string | null; modified?: string };

const node = (p: FakeProposal) => ({
  id: p.id,
  boosted: false,
  status: { status: p.status, status_label: p.status === "Accepted" ? "Submitted" : p.status },
  marketplaceJobPosting: { id: p.jobId, content: { title: p.title ?? "Some job" }, url: `https://www.upwork.com/jobs/~02${p.jobId}?utm_source=claude` },
  auditDetails: {
    createdDateTime: { displayValue: "2026-09-07T14:26:03.250Z", rawValue: "1788791163250" },
    modifiedDateTime: { displayValue: p.modified ?? "2026-09-15T19:31:07.506Z", rawValue: "1789500667506" },
  },
  terms: { chargeRate: { currency: "USD", displayValue: "USD 25.0", rawValue: "25.0" } },
});

// Answers like the live tool: action=list filters by params.status, action=get returns the
// proposal with its room_id (null → a "no room" error status, which callers must survive).
export function proposalsFixture(proposals: FakeProposal[]) {
  return (args: Record<string, unknown>) => {
    const params = (args.params ?? {}) as { status?: string; id?: string };
    if (args.action === "get") {
      const p = proposals.find((x) => x.id === params.id);
      if (!p) return { status: "error", message: "not found" };
      return { status: "ok", data: { vendorProposal: node(p) }, room_id: p.roomId ?? undefined, plan: "Freelancer Basic", insights_available: false };
    }
    const rows = proposals.filter((p) => p.status === (params.status ?? "Accepted"));
    return { status: "ok", hasMore: false, data: { vendorProposals: { edges: rows.map((p) => ({ node: node(p) })), pageInfo: { hasNextPage: false } } } };
  };
}
