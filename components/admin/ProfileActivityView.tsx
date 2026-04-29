"use client";

import { useEffect, useState } from "react";

type TimelineItem = {
  kind: "proposal" | "job" | "alert" | "snapshot";
  at: string;
  title: string;
  url: string | null;
  by: { id: string; name: string } | null;
  subjectId: string;
};

const KIND_STYLES: Record<TimelineItem["kind"], { label: string; dot: string; badge: string }> = {
  proposal: { label: "Proposal",   dot: "bg-blue-500",   badge: "bg-blue-50 text-blue-700 border-blue-100" },
  job:      { label: "Job viewed", dot: "bg-amber-500",  badge: "bg-amber-50 text-amber-700 border-amber-100" },
  alert:    { label: "Alert",      dot: "bg-purple-500", badge: "bg-purple-50 text-purple-700 border-purple-100" },
  snapshot: { label: "Snapshot",   dot: "bg-teal-500",   badge: "bg-teal-50 text-teal-700 border-teal-100" },
};

const KIND_FILTERS: { value: TimelineItem["kind"] | "all"; label: string }[] = [
  { value: "all",      label: "All" },
  { value: "proposal", label: "Proposals" },
  { value: "job",      label: "Jobs" },
  { value: "alert",    label: "Alerts" },
  { value: "snapshot", label: "Snapshots" },
];

function fmtDateTime(d: string) {
  return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function ProfileActivityView({ accountId, accountName }: { accountId: string; accountName: string }) {
  const [items, setItems] = useState<TimelineItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<TimelineItem["kind"] | "all">("all");

  useEffect(() => {
    if (!accountId) return;
    setLoading(true);
    setError(null);
    setItems(null);
    fetch(`/api/admin/profile/${accountId}/timeline`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((data) => { setItems(data.items ?? []); setTotal(data.total ?? 0); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [accountId]);

  const filtered = items
    ? kindFilter === "all" ? items : items.filter((i) => i.kind === kindFilter)
    : null;

  const counts = items
    ? { proposal: items.filter((i) => i.kind === "proposal").length, job: items.filter((i) => i.kind === "job").length, alert: items.filter((i) => i.kind === "alert").length, snapshot: items.filter((i) => i.kind === "snapshot").length }
    : null;

  return (
    <div className="py-6 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Profile Activity</h2>
          {accountName && <p className="text-xs text-gray-400 mt-0.5">{total} actions on {accountName}</p>}
        </div>
        {items && items.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {KIND_FILTERS.map((f) => {
              const count = f.value === "all" ? total : (counts?.[f.value] ?? 0);
              const isActive = kindFilter === f.value;
              return (
                <button
                  key={f.value}
                  onClick={() => setKindFilter(f.value)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    isActive
                      ? "bg-teal-500 text-white"
                      : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {f.label}
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${isActive ? "bg-teal-400 text-white" : "bg-gray-100 text-gray-500"}`}>{count}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-lg bg-rose-50 border border-rose-100 p-3 text-sm text-rose-700">{error}</div>
      )}

      {loading ? (
        <div className="bg-white border border-gray-200 rounded-xl p-12 text-center text-sm text-gray-400">Loading…</div>
      ) : !filtered || filtered.length === 0 ? (
        <div className="bg-white border border-dashed border-gray-200 rounded-xl p-12 text-center">
          <p className="text-sm text-gray-500 font-medium">
            {kindFilter === "all" ? "No activity captured yet" : `No ${kindFilter}s captured yet`}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            {kindFilter === "all"
              ? "Make sure the extension is active and the bidder is browsing this account."
              : "Try switching to a different filter."}
          </p>
        </div>
      ) : (
        <div className="relative">
          <div className="absolute left-5 top-0 bottom-0 w-px bg-gray-200" />
          <ul className="space-y-3 pl-12">
            {filtered.map((item, i) => {
              const s = KIND_STYLES[item.kind];
              return (
                <li key={`${item.subjectId}-${i}`} className="relative">
                  <div className={`absolute -left-[31px] mt-1 w-3 h-3 rounded-full border-2 border-white ${s.dot}`} />
                  <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 flex items-start gap-3 hover:border-gray-300 transition-colors">
                    <span className={`mt-0.5 shrink-0 px-2 py-0.5 text-[10px] font-medium rounded border ${s.badge}`}>{s.label}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900 truncate">
                        {item.url ? (
                          <a href={item.url} target="_blank" rel="noopener noreferrer" className="hover:text-teal-600 transition-colors">{item.title}</a>
                        ) : item.title}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-400">
                        <span>{fmtDateTime(item.at)}</span>
                        {item.by ? (
                          <><span>·</span><span className="font-medium text-gray-500">{item.by.name}</span></>
                        ) : (
                          <span>· attribution unknown</span>
                        )}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
