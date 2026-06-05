"use client";

import { useCallback, useEffect, useState } from "react";
import { Spinner } from "@/components/ui/Spinner";
import type { AccountData } from "@/lib/overview-types";

type Keyword = { id: string; text: string };

interface Props {
  accounts: AccountData[];
  onToggleDisabled: (account: AccountData) => void;
}

export function AccountManagementView({ accounts, onToggleDisabled }: Props) {
  const [search, setSearch] = useState("");

  const filtered = accounts.filter((a) =>
    a.name.toLowerCase().includes(search.toLowerCase())
  );

  const active = filtered.filter((a) => !a.isDisabled);
  const disabled = filtered.filter((a) => a.isDisabled);

  return (
    <div className="p-4 lg:p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Account Management</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {accounts.length} account{accounts.length !== 1 ? "s" : ""} —{" "}
            {accounts.filter((a) => a.isDisabled).length} disabled
          </p>
        </div>
        <input
          type="text"
          placeholder="Search accounts…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 w-48 focus:outline-none focus:ring-2 focus:ring-teal-500"
        />
      </div>

      {active.length > 0 && (
        <section className="mb-8">
          <h3 className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-3">
            Active ({active.length})
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {active.map((acc) => (
              <AccountCard key={acc.id} account={acc} onToggleDisabled={onToggleDisabled} />
            ))}
          </div>
        </section>
      )}

      {disabled.length > 0 && (
        <section>
          <h3 className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-3">
            Disabled ({disabled.length})
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {disabled.map((acc) => (
              <AccountCard key={acc.id} account={acc} onToggleDisabled={onToggleDisabled} />
            ))}
          </div>
        </section>
      )}

      {filtered.length === 0 && (
        <p className="text-sm text-gray-400 text-center py-12">No accounts match your search.</p>
      )}
    </div>
  );
}

function AccountCard({
  account,
  onToggleDisabled,
}: {
  account: AccountData;
  onToggleDisabled: (account: AccountData) => void;
}) {
  return (
    <div
      className={`rounded-2xl border p-4 flex flex-col gap-3 ${
        account.isDisabled ? "border-gray-200 bg-gray-50 opacity-70" : "border-gray-200 bg-white"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`text-sm font-semibold truncate ${account.isDisabled ? "text-gray-400" : "text-gray-900"}`}>
            {account.name}
          </span>
          {account.isDisabled ? (
            <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-red-50 text-red-500 border border-red-100">
              Disabled
            </span>
          ) : (
            <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-green-50 text-green-600 border border-green-100">
              Active
            </span>
          )}
          {account.isDisabled && account.disabledReason && (
            <span className="shrink-0 text-xs text-red-400">— {account.disabledReason}</span>
          )}
        </div>
        <button
          onClick={() => onToggleDisabled(account)}
          className={`shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors ${
            account.isDisabled
              ? "border-green-200 text-green-700 bg-green-50 hover:bg-green-100"
              : "border-red-200 text-red-600 bg-red-50 hover:bg-red-100"
          }`}
        >
          {account.isDisabled ? "Re-enable" : "Disable"}
        </button>
      </div>

      <KeywordsEditor accountId={account.id} />
    </div>
  );
}

function KeywordsEditor({ accountId }: { accountId: string }) {
  const [keywords, setKeywords] = useState<Keyword[] | null>(null);
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/accounts/${accountId}/keywords`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setKeywords(data.keywords);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, [accountId]);

  useEffect(() => {
    load();
  }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/accounts/${accountId}/keywords`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setKeywords((prev) => [...(prev ?? []), data.keyword]);
      setInput("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    const prev = keywords ?? [];
    setKeywords(prev.filter((k) => k.id !== id));
    try {
      const res = await fetch(`/api/admin/accounts/${accountId}/keywords/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      setKeywords(prev);
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  return (
    <div className="border-t border-gray-100 pt-3">
      <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-2">Keywords</div>
      {keywords === null ? (
        <div className="text-xs text-gray-400 mb-2">Loading…</div>
      ) : keywords.length === 0 ? (
        <div className="text-xs text-gray-400 mb-2">No keywords yet.</div>
      ) : (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {keywords.map((k) => (
            <span
              key={k.id}
              className="inline-flex items-center gap-1 rounded-full bg-teal-50 border border-teal-100 text-teal-700 px-2.5 py-0.5 text-[11px] font-medium"
            >
              <span className="break-all">{k.text}</span>
              <button
                type="button"
                onClick={() => remove(k.id)}
                aria-label={`Remove ${k.text}`}
                className="text-teal-500 hover:text-rose-600 leading-none"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <form onSubmit={add} className="flex items-center gap-1.5">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Add a keyword"
          maxLength={200}
          className="flex-1 min-w-0 border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-teal-500"
        />
        <button
          type="submit"
          disabled={saving || !input.trim()}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-teal-500 hover:bg-teal-600 disabled:opacity-50 text-white text-xs font-medium rounded-lg shadow-sm"
        >
          {saving ? <Spinner className="w-3 h-3" /> : "Add"}
        </button>
      </form>
      {error && <div className="mt-1.5 text-[11px] text-rose-600">{error}</div>}
    </div>
  );
}
