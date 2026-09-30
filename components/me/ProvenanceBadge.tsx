// Says where a piece of data came from, so self-reported data is never mistaken for
// something Upwork confirmed (handover §1 guardrail 6).
const STYLES: Record<string, { label: string; title: string; cls: string }> = {
  MCP_VERIFIED: {
    label: "Verified by Upwork",
    title: "Returned by Upwork's official connection",
    cls: "bg-green-50 text-green-700 border-green-200",
  },
  DEVELOPER_CONFIRMED: {
    label: "Self-reported",
    title: "Confirmed by the bidder; not independently verified",
    cls: "bg-amber-50 text-amber-700 border-amber-200",
  },
  APP_RECORDED: {
    label: "Recorded here",
    title: "Recorded by an action inside this app",
    cls: "bg-gray-50 text-gray-600 border-gray-200",
  },
  MOCK: {
    label: "Test data",
    title: "Local test data — not from Upwork",
    cls: "bg-purple-50 text-purple-700 border-purple-200",
  },
};

export function ProvenanceBadge({ provenance }: { provenance: string | null | undefined }) {
  const s = provenance ? STYLES[provenance] : null;
  if (!s) return null;
  return (
    <span
      title={s.title}
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium whitespace-nowrap ${s.cls}`}
    >
      {s.label}
    </span>
  );
}
