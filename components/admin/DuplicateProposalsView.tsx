"use client";

import { useCallback, useEffect, useState } from "react";
import { Spinner } from "@/components/ui/Spinner";

type ProposalRow = {
  id: string;
  accountId: string;
  accountName: string;
  profileUsed: string | null;
  submittedAt: string | null;
  capturedAt: string | null;
  clientName: string | null;
};

type DupGroup = {
  groupKey: string;
  jobUrl: string | null;
  jobTitle: string | null;
  toDelete?: ProposalRow[];
  toKeep?: ProposalRow[];
  proposals?: ProposalRow[];
};

type Data = { tier1: DupGroup[]; tier2: DupGroup[] };

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return (
    d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) +
    " " +
    d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
  );
}

function JobLabel({
  jobTitle,
  jobUrl,
  className,
}: {
  jobTitle: string | null;
  jobUrl: string | null;
  className?: string;
}) {
  const label = jobTitle ?? <span className="italic text-gray-400 font-normal">Untitled job</span>;
  if (jobUrl) {
    return (
      <a
        href={jobUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
        title={jobTitle ?? jobUrl}
      >
        {label}
      </a>
    );
  }
  return <span className={className}>{label}</span>;
}

export function DuplicateProposalsView() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  // tier1 bulk delete state
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // tier2 per-row delete state: maps proposal id -> loading
  const [deletingIds, setDeletingIds] = useState<Record<string, boolean>>({});
  // tier2 per-group delete-all state: maps groupKey -> loading
  const [deletingGroups, setDeletingGroups] = useState<Record<string, boolean>>({});

  const loadData = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/duplicate-proposals", { cache: "no-store" });
      if (res.status === 401) {
        window.location.href = "/admin/login";
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: Data = await res.json();
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleBulkDelete() {
    if (!data) return;
    const ids = data.tier1.flatMap((g) => (g.toDelete ?? []).map((p) => p.id));
    setBulkDeleting(true);
    try {
      const res = await fetch("/api/admin/duplicate-proposals", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((prev) => (prev ? { ...prev, tier1: [] } : prev));
      setConfirmBulk(false);
    } catch (e) {
      alert(`Failed: ${e instanceof Error ? e.message : "unknown"}`);
    } finally {
      setBulkDeleting(false);
    }
  }

  async function handleDeleteGroup(groupKey: string, ids: string[]) {
    setDeletingGroups((prev) => ({ ...prev, [groupKey]: true }));
    try {
      const res = await fetch("/api/admin/duplicate-proposals", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((prev) =>
        prev ? { ...prev, tier2: prev.tier2.filter((g) => g.groupKey !== groupKey) } : prev
      );
    } catch (e) {
      alert(`Failed: ${e instanceof Error ? e.message : "unknown"}`);
    } finally {
      setDeletingGroups((prev) => {
        const next = { ...prev };
        delete next[groupKey];
        return next;
      });
    }
  }

  async function handleDeleteOne(proposalId: string) {
    setDeletingIds((prev) => ({ ...prev, [proposalId]: true }));
    try {
      const res = await fetch("/api/admin/duplicate-proposals", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [proposalId] }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((prev) => {
        if (!prev) return prev;
        return {
          tier1: prev.tier1.map((g) => ({
            ...g,
            toKeep: (g.toKeep ?? []).filter((p) => p.id !== proposalId),
            toDelete: (g.toDelete ?? []).filter((p) => p.id !== proposalId),
          })),
          tier2: prev.tier2
            .map((g) => ({
              ...g,
              proposals: (g.proposals ?? []).filter((p) => p.id !== proposalId),
            }))
            .filter((g) => (g.proposals ?? []).length > 1),
        };
      });
    } catch (e) {
      alert(`Failed: ${e instanceof Error ? e.message : "unknown"}`);
    } finally {
      setDeletingIds((prev) => {
        const next = { ...prev };
        delete next[proposalId];
        return next;
      });
    }
  }

  if (data === null && !error) {
    return (
      <div className="p-6">
        <div className="bg-white border border-gray-200 rounded-xl p-12 flex items-center justify-center gap-3 text-sm text-gray-500">
          <Spinner />
          Loading…
        </div>
      </div>
    );
  }

  const tier1 = data?.tier1 ?? [];
  const tier2 = data?.tier2 ?? [];
  const allEmpty = tier1.length === 0 && tier2.length === 0;
  const tier1DeleteCount = tier1.reduce((n, g) => n + (g.toDelete?.length ?? 0), 0);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Duplicate Proposals</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Review and clean up proposals captured more than once for the same job.
        </p>
      </div>

      {error && (
        <div className="rounded-lg bg-rose-50 border border-rose-100 p-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      {allEmpty && !error && (
        <div className="bg-white border border-gray-200 rounded-xl p-12 flex flex-col items-center gap-3 text-center">
          <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
            <svg
              className="w-5 h-5 text-green-600"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-900">No duplicate proposals found</p>
            <p className="text-sm text-gray-500 mt-0.5">All proposals look clean.</p>
          </div>
        </div>
      )}

      {/* Tier 1 */}
      {tier1.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
              <span className="font-semibold">{tier1DeleteCount} proposal{tier1DeleteCount !== 1 ? "s" : ""}</span>{" "}
              were misattributed in bulk sync events and can be safely deleted.
            </div>
            {!confirmBulk && (
              <button
                onClick={() => setConfirmBulk(true)}
                className="shrink-0 inline-flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition-colors shadow-sm"
              >
                Delete all {tier1DeleteCount} misattributed proposal{tier1DeleteCount !== 1 ? "s" : ""}
              </button>
            )}
            {confirmBulk && (
              <div className="shrink-0 flex items-center gap-2">
                <span className="text-sm text-gray-600 font-medium">Are you sure? This cannot be undone.</span>
                <button
                  onClick={() => setConfirmBulk(false)}
                  disabled={bulkDeleting}
                  className="px-3 py-1.5 bg-white border border-gray-200 text-gray-700 text-sm rounded-lg hover:bg-gray-50 shadow-sm transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleBulkDelete}
                  disabled={bulkDeleting}
                  className="inline-flex items-center gap-2 px-3 py-1.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors shadow-sm"
                >
                  {bulkDeleting && <Spinner />}
                  {bulkDeleting ? "Deleting…" : "Yes, delete all"}
                </button>
              </div>
            )}
          </div>

          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="bg-gray-50 border-b border-gray-200 px-5 py-2.5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                Tier 1 — Bulk Sync Duplicates
              </h3>
            </div>
            <ul className="divide-y divide-gray-100">
              {tier1.map((group, i) => {
                const keep = group.toKeep ?? [];
                const del = group.toDelete ?? [];
                return (
                  <li key={i} className="px-5 py-3 flex items-center gap-4 text-sm">
                    <div className="w-48 shrink-0 truncate font-medium text-gray-900">
                      <JobLabel
                        jobTitle={group.jobTitle}
                        jobUrl={group.jobUrl}
                        className="hover:text-teal-600 hover:underline"
                      />
                    </div>

                    <div className="flex items-center gap-6 flex-1 min-w-0">
                      {keep.map((p) => (
                        <div key={p.id} className="flex flex-col gap-0.5">
                          <span className="text-[11px] uppercase tracking-wide text-green-600 font-semibold">
                            Keep
                          </span>
                          <span className="text-gray-900 font-medium truncate">{p.accountName}</span>
                          <span className="text-xs text-gray-500">{fmtDateTime(p.capturedAt)}</span>
                          <button
                            onClick={() => handleDeleteOne(p.id)}
                            disabled={!!deletingIds[p.id]}
                            className="mt-1 inline-flex items-center gap-1 px-2 py-1 bg-white border border-red-200 hover:bg-red-50 disabled:opacity-50 text-red-600 text-[10px] font-medium rounded transition-colors"
                          >
                            {deletingIds[p.id] && <Spinner />}
                            {deletingIds[p.id] ? "Deleting…" : "Delete this one"}
                          </button>
                        </div>
                      ))}

                      <svg
                        className="w-4 h-4 text-gray-300 shrink-0"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M5 12h14M13 6l6 6-6 6" />
                      </svg>

                      {del.map((p) => (
                        <div key={p.id} className="flex flex-col gap-0.5">
                          <span className="text-[11px] uppercase tracking-wide text-red-500 font-semibold">
                            Delete
                          </span>
                          <div className="flex items-center gap-1.5">
                            <span className="text-gray-900 font-medium truncate">{p.accountName}</span>
                            <span className="rounded-full bg-red-100 text-red-700 px-2 py-0.5 text-[10px] font-semibold">
                              Bulk sync
                            </span>
                          </div>
                          <span className="text-xs text-gray-500">{fmtDateTime(p.capturedAt)}</span>
                        </div>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      )}

      {/* Tier 2 */}
      {tier2.length > 0 && (
        <section className="space-y-3">
          <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
            <h3 className="text-sm font-semibold text-gray-700">
              Tier 2 — Needs Manual Review
            </h3>
            <p className="text-sm text-gray-500 mt-0.5">
              These duplicates could not be automatically resolved. Review each group and delete the one to remove.
            </p>
          </div>

          <div className="space-y-3">
            {tier2.map((group, i) => {
              const proposals = group.proposals ?? [];
              return (
                <div key={i} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                  <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between gap-4">
                    <JobLabel
                      jobTitle={group.jobTitle}
                      jobUrl={group.jobUrl}
                      className="text-sm font-semibold text-gray-900 hover:text-teal-600 hover:underline"
                    />
                    <button
                      onClick={() => handleDeleteGroup(group.groupKey, proposals.map((p) => p.id))}
                      disabled={!!deletingGroups[group.groupKey]}
                      className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors shadow-sm"
                    >
                      {deletingGroups[group.groupKey] && <Spinner />}
                      {deletingGroups[group.groupKey] ? "Deleting…" : "Delete all in group"}
                    </button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 text-left text-xs uppercase tracking-wider text-gray-500">
                        <tr>
                          <th className="px-5 py-2.5 font-medium">Account</th>
                          <th className="px-5 py-2.5 font-medium">Profile Used</th>
                          <th className="px-5 py-2.5 font-medium">Submitted</th>
                          <th className="px-5 py-2.5 font-medium">Captured At</th>
                          <th className="px-5 py-2.5" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {proposals.map((p) => (
                          <tr key={p.id} className="hover:bg-gray-50">
                            <td className="px-5 py-3 font-medium text-gray-900">{p.accountName}</td>
                            <td className="px-5 py-3 text-gray-600">
                              {p.profileUsed ?? <span className="text-gray-400">—</span>}
                            </td>
                            <td className="px-5 py-3 text-gray-600">{fmtDateTime(p.submittedAt)}</td>
                            <td className="px-5 py-3 text-gray-600">{fmtDateTime(p.capturedAt)}</td>
                            <td className="px-5 py-3 text-right">
                              <button
                                onClick={() => handleDeleteOne(p.id)}
                                disabled={!!deletingIds[p.id]}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors shadow-sm"
                              >
                                {deletingIds[p.id] && <Spinner />}
                                {deletingIds[p.id] ? "Deleting…" : "Delete this one"}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
