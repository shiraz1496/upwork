"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Bidder = {
  id: string;
  name: string;
  email: string;
  status: "active" | "inactive";
};

type AccountRow = {
  id: string;
  name: string;
  freelancerId: string;
  primaryOwnerId: string | null;
  primaryOwnerName: string | null;
  capturerIds: string[];
};

export function AccountOwnershipView() {
  const [accounts, setAccounts] = useState<AccountRow[] | null>(null);
  const [bidders, setBidders] = useState<Bidder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterOwner, setFilterOwner] = useState<string>("all"); // "all" | "unassigned" | bidder id

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/accounts", { cache: "no-store" });
      if (res.status === 401) {
        window.location.href = "/admin/login";
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setAccounts(data.accounts);
      setBidders(data.bidders);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function setOwner(accountId: string, primaryOwnerId: string | null) {
    setSavingId(accountId);
    try {
      const res = await fetch(`/api/admin/accounts/${accountId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ primaryOwnerId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const updated = await res.json();
      setAccounts((prev) =>
        prev
          ? prev.map((a) =>
              a.id === accountId
                ? { ...a, primaryOwnerId: updated.primaryOwnerId, primaryOwnerName: updated.primaryOwnerName }
                : a,
            )
          : prev,
      );
    } catch (e) {
      alert(`Failed: ${e instanceof Error ? e.message : "unknown"}`);
    } finally {
      setSavingId(null);
    }
  }

  const bidderById = useMemo(() => new Map(bidders.map((b) => [b.id, b])), [bidders]);

  const filtered = useMemo(() => {
    if (!accounts) return null;
    const q = search.trim().toLowerCase();
    return accounts.filter((a) => {
      if (filterOwner === "unassigned" && a.primaryOwnerId) return false;
      if (filterOwner !== "all" && filterOwner !== "unassigned" && a.primaryOwnerId !== filterOwner) return false;
      if (q && !a.name.toLowerCase().includes(q) && !a.freelancerId.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [accounts, search, filterOwner]);

  const ownershipCounts = useMemo(() => {
    const m = new Map<string, number>();
    let unassigned = 0;
    for (const a of accounts ?? []) {
      if (!a.primaryOwnerId) unassigned++;
      else m.set(a.primaryOwnerId, (m.get(a.primaryOwnerId) ?? 0) + 1);
    }
    return { byBidder: m, unassigned };
  }, [accounts]);

  return (
    <div className="p-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Account Ownership</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Each account has one primary bidder. Filters and per-bidder dropdowns use this assignment.
        </p>
      </div>

      {error && (
        <div className="rounded-lg bg-rose-50 border border-rose-100 p-3 text-sm text-rose-700">{error}</div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          placeholder="Search by name or freelancer id…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[220px] border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-teal-500"
        />
        <select
          value={filterOwner}
          onChange={(e) => setFilterOwner(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-teal-500"
        >
          <option value="all">All owners</option>
          <option value="unassigned">Unassigned ({ownershipCounts.unassigned})</option>
          {bidders.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name} ({ownershipCounts.byBidder.get(b.id) ?? 0})
            </option>
          ))}
        </select>
      </div>

      {accounts === null ? (
        <div className="bg-white border border-gray-200 rounded-xl p-12 text-center text-sm text-gray-500">
          Loading…
        </div>
      ) : filtered && filtered.length === 0 ? (
        <div className="bg-white border border-dashed border-gray-300 rounded-xl p-12 text-center text-sm text-gray-500">
          No accounts match.
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wider text-gray-500">
              <tr>
                <th className="px-5 py-3 font-medium">Account</th>
                <th className="px-5 py-3 font-medium">Freelancer ID</th>
                <th className="px-5 py-3 font-medium">Owner</th>
                <th className="px-5 py-3 font-medium">Captured by</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(filtered ?? []).map((a) => (
                <tr key={a.id} className="hover:bg-gray-50">
                  <td className="px-5 py-3 font-medium text-gray-900">{a.name}</td>
                  <td className="px-5 py-3 text-xs text-gray-500 font-mono">{a.freelancerId}</td>
                  <td className="px-5 py-3">
                    <select
                      value={a.primaryOwnerId ?? ""}
                      disabled={savingId === a.id}
                      onChange={(e) => setOwner(a.id, e.target.value || null)}
                      className="border border-gray-200 rounded-lg px-2 py-1 text-sm bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:opacity-60"
                    >
                      <option value="">— unassigned —</option>
                      {bidders.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                          {b.status === "inactive" ? " (inactive)" : ""}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-5 py-3 text-xs text-gray-600">
                    {a.capturerIds.length === 0 ? (
                      <span className="italic text-gray-400">no captures</span>
                    ) : (
                      a.capturerIds
                        .map((id) => bidderById.get(id)?.name ?? null)
                        .filter(Boolean)
                        .join(", ") || <span className="italic text-gray-400">admin only</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
