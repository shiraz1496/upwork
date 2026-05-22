"use client";

import { useState } from "react";
import type { AccountData } from "@/lib/overview-types";

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
    </div>
  );
}
