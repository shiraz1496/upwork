"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Scope = "all" | "proposals" | "contracts";

type BlockedTitle = {
  id: string;
  pattern: string;
  scope: Scope;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

const SCOPE_LABEL: Record<Scope, string> = {
  all: "All (proposals + contracts)",
  proposals: "Proposals only",
  contracts: "Contracts only",
};

const SCOPE_BADGE: Record<Scope, string> = {
  all: "bg-gray-100 text-gray-700",
  proposals: "bg-blue-50 text-blue-700",
  contracts: "bg-purple-50 text-purple-700",
};

function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-block rounded-full border-2 border-current border-t-transparent animate-spin ${className}`}
    />
  );
}

type SyncSampleRow = {
  id: string;
  jobTitle: string | null;
  clientCompany: string | null;
  hiredAt: string | null;
  contractStatus: string | null;
  accountId: string;
};

type SyncResult = {
  matched: number;
  deleted: number;
  sample: SyncSampleRow[];
};

export function BlockedTitlesView() {
  const [titles, setTitles] = useState<BlockedTitle[]>([]);
  const [loading, setLoading] = useState(true);
  const [scopeFilter, setScopeFilter] = useState<Scope | "any">("any");
  const [query, setQuery] = useState("");

  const [newPattern, setNewPattern] = useState("");
  const [newScope, setNewScope] = useState<Scope>("all");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [pendingId, setPendingId] = useState<string | null>(null);

  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/blocked-titles", { cache: "no-store" });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = await res.json();
      setTitles(Array.isArray(data.titles) ? data.titles : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function upsertLocal(updated: BlockedTitle) {
    setTitles((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
  }

  async function addTitle(e: React.FormEvent) {
    e.preventDefault();
    const pattern = newPattern.trim();
    if (pattern.length < 2) {
      setCreateError("Pattern must be at least 2 characters.");
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/admin/blocked-titles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pattern, scope: newScope, active: true }),
      });
      if (res.status === 409) {
        setCreateError("That pattern already exists.");
        return;
      }
      if (!res.ok) {
        setCreateError("Failed to add. Try again.");
        return;
      }
      const { title } = (await res.json()) as { title: BlockedTitle };
      setTitles((prev) => [title, ...prev]);
      setNewPattern("");
      setNewScope("all");
    } finally {
      setCreating(false);
    }
  }

  async function changeScope(t: BlockedTitle, scope: Scope) {
    setPendingId(t.id);
    try {
      const res = await fetch(`/api/admin/blocked-titles/${t.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope }),
      });
      if (res.ok) {
        const { title } = (await res.json()) as { title: BlockedTitle };
        upsertLocal(title);
      }
    } finally {
      setPendingId(null);
    }
  }

  async function deleteTitle(t: BlockedTitle) {
    if (!confirm(`Delete blocked title "${t.pattern}"?`)) return;
    setPendingId(t.id);
    try {
      const res = await fetch(`/api/admin/blocked-titles/${t.id}`, { method: "DELETE" });
      if (res.ok) setTitles((prev) => prev.filter((x) => x.id !== t.id));
    } finally {
      setPendingId(null);
    }
  }

  async function runSync(dryRun: boolean) {
    setSyncing(true);
    setSyncError(null);
    if (dryRun) setSyncResult(null);
    try {
      const res = await fetch("/api/admin/blocked-titles/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun }),
      });
      if (!res.ok) {
        setSyncError(`Failed (status ${res.status})`);
        return;
      }
      const data = (await res.json()) as SyncResult;
      setSyncResult(data);
    } catch {
      setSyncError("Network error.");
    } finally {
      setSyncing(false);
    }
  }

  async function confirmDeleteMatches() {
    if (!syncResult || syncResult.matched === 0) return;
    const ok = confirm(
      `Permanently delete ${syncResult.matched} stored proposal/contract row(s) whose title matches an active blocked pattern?`,
    );
    if (!ok) return;
    await runSync(false);
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return titles.filter((t) => {
      if (scopeFilter !== "any" && t.scope !== scopeFilter) return false;
      if (q && !t.pattern.includes(q)) return false;
      return true;
    });
  }, [titles, scopeFilter, query]);

  const counts = useMemo(() => {
    const c = { all: 0, proposals: 0, contracts: 0 };
    for (const t of titles) {
      c[t.scope] += 1;
    }
    return c;
  }, [titles]);

  return (
    <section className="mt-6">
      <div className="mb-4">
        <h2 className="text-base font-semibold text-gray-900">Blocked Titles</h2>
        <p className="text-xs text-gray-400 mt-0.5">
          Strings the scraper must NOT save as a job title. Matching rule: short
          patterns (≤2 words) must match exactly; 3+ word phrases match as
          substrings. Changes propagate to the server within ~60s.
        </p>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4 shadow-sm">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">
              Clean up stored data
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">
              Scan existing proposals & contracts for rows whose title matches an
              active blocked pattern, then delete them.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={syncing}
              onClick={() => runSync(true)}
              className="h-[34px] px-3 rounded-lg border border-gray-200 text-sm text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {syncing && !syncResult?.deleted ? <Spinner className="w-3.5 h-3.5" /> : null}
              Scan
            </button>
            {syncResult && syncResult.matched > 0 && syncResult.deleted === 0 && (
              <button
                type="button"
                disabled={syncing}
                onClick={confirmDeleteMatches}
                className="h-[34px] px-3 rounded-lg bg-rose-500 text-white text-sm font-medium hover:bg-rose-600 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {syncing ? <Spinner className="w-3.5 h-3.5" /> : null}
                Delete {syncResult.matched} row{syncResult.matched !== 1 ? "s" : ""}
              </button>
            )}
          </div>
        </div>

        {syncError && (
          <div className="mt-3 text-xs text-rose-600">{syncError}</div>
        )}

        {syncResult && (
          <div className="mt-3">
            {syncResult.deleted > 0 ? (
              <div className="text-xs text-green-700 bg-green-50 border border-green-100 rounded-lg px-3 py-2">
                Deleted {syncResult.deleted} row{syncResult.deleted !== 1 ? "s" : ""}.
              </div>
            ) : syncResult.matched === 0 ? (
              <div className="text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
                No stored rows match the active blocked titles. Nothing to clean up.
              </div>
            ) : (
              <>
                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-2">
                  {syncResult.matched} row{syncResult.matched !== 1 ? "s" : ""} would be
                  deleted. Showing up to {syncResult.sample.length} sample{syncResult.sample.length !== 1 ? "s" : ""} below.
                </div>
                <div className="border border-gray-200 rounded-lg overflow-hidden max-h-64 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-2 text-gray-500 font-medium uppercase tracking-wide">
                          jobTitle
                        </th>
                        <th className="text-left px-3 py-2 text-gray-500 font-medium uppercase tracking-wide">
                          Client
                        </th>
                        <th className="text-left px-3 py-2 text-gray-500 font-medium uppercase tracking-wide">
                          Type
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {syncResult.sample.map((row) => (
                        <tr key={row.id} className="border-t border-gray-100">
                          <td className="px-3 py-1.5 font-mono text-gray-800 break-all">
                            {row.jobTitle ?? "—"}
                          </td>
                          <td className="px-3 py-1.5 text-gray-500">
                            {row.clientCompany ?? "—"}
                          </td>
                          <td className="px-3 py-1.5 text-gray-500">
                            {row.hiredAt ? "Contract" : "Proposal"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <form
        onSubmit={addTitle}
        className="bg-white border border-gray-200 rounded-xl p-4 mb-4 flex flex-col gap-3 shadow-sm"
      >
        <div className="grid grid-cols-1 md:grid-cols-[1fr_220px_auto] gap-3">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">
              Pattern
            </label>
            <input
              type="text"
              value={newPattern}
              onChange={(e) => setNewPattern(e.target.value)}
              placeholder='e.g. "freelancer plus"'
              className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">
              Scope
            </label>
            <select
              value={newScope}
              onChange={(e) => setNewScope(e.target.value as Scope)}
              className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
            >
              <option value="all">All</option>
              <option value="proposals">Proposals only</option>
              <option value="contracts">Contracts only</option>
            </select>
          </div>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={creating}
              className="h-[38px] px-4 rounded-lg bg-teal-500 text-white text-sm font-medium hover:bg-teal-600 transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {creating ? <Spinner className="w-3.5 h-3.5" /> : null}
              Add
            </button>
          </div>
        </div>
        {createError && (
          <div className="text-xs text-rose-600">{createError}</div>
        )}
      </form>

      <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
        <span className="text-gray-400">{titles.length} total</span>
        <div className="flex-1" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search…"
          className="border border-gray-200 rounded-lg px-2.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-teal-500"
        />
        <select
          value={scopeFilter}
          onChange={(e) => setScopeFilter(e.target.value as Scope | "any")}
          className="border border-gray-200 rounded-lg px-2 py-1 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
        >
          <option value="any">All scopes</option>
          <option value="all">All ({counts.all})</option>
          <option value="proposals">Proposals ({counts.proposals})</option>
          <option value="contracts">Contracts ({counts.contracts})</option>
        </select>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
        {loading ? (
          <div className="py-10 text-center text-sm text-gray-400">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="py-10 text-center text-sm text-gray-400">
            {titles.length === 0
              ? "No blocked titles yet. Add one above."
              : "No matches for the current filter."}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left px-4 py-3 text-gray-500 font-medium text-xs uppercase tracking-wide">
                  Pattern
                </th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium text-xs uppercase tracking-wide">
                  Scope
                </th>
                <th className="text-left px-4 py-3 text-gray-500 font-medium text-xs uppercase tracking-wide">
                  Added
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr
                  key={t.id}
                  className="border-b border-gray-100 last:border-0"
                >
                  <td className="px-4 py-3 font-mono text-[13px] text-gray-800 break-all">
                    {t.pattern}
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={t.scope}
                      disabled={pendingId === t.id}
                      onChange={(e) => changeScope(t, e.target.value as Scope)}
                      className={`text-[11px] font-medium px-2 py-1 rounded-full border-0 cursor-pointer ${SCOPE_BADGE[t.scope]}`}
                    >
                      <option value="all">{SCOPE_LABEL.all}</option>
                      <option value="proposals">{SCOPE_LABEL.proposals}</option>
                      <option value="contracts">{SCOPE_LABEL.contracts}</option>
                    </select>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                    {new Date(t.createdAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      disabled={pendingId === t.id}
                      onClick={() => deleteTitle(t)}
                      className="text-xs text-rose-600 hover:text-rose-700 font-medium disabled:opacity-50"
                    >
                      {pendingId === t.id ? <Spinner className="w-3 h-3" /> : "Delete"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
