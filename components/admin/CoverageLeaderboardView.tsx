"use client";

import { useEffect, useMemo, useState } from "react";

type LeaderboardEntry = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "bidder";
  events: number;
  relativePct: number;
};

type LeaderboardData = {
  month: string;
  totalPages: number;
  results: LeaderboardEntry[];
};

function generateMonthOptions(): { value: string; label: string }[] {
  const options = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    options.push({ value, label });
  }
  return options;
}

const MEDALS = ["🥇", "🥈", "🥉"];

export function CoverageLeaderboardView() {
  const MONTH_OPTIONS = useMemo(() => generateMonthOptions(), []);
  const [month, setMonth] = useState(() => generateMonthOptions()[0].value);
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/admin/coverage-leaderboard?month=${month}`, { cache: "no-store" })
      .then((r) => {
        if (r.status === 401) { window.location.href = "/admin/login"; return null; }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => { if (d) setData(d); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [month]);

  const monthLabel = MONTH_OPTIONS.find((o) => o.value === month)?.label ?? month;
  const hasActivity = data ? data.results.some((r) => r.events > 0) : false;
  const winner = data?.results[0];

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Coverage Leaderboard</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Points are earned by visiting a required page while it was uncovered.
            Revisiting an already-covered page scores nothing.
          </p>
        </div>
        <select
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-teal-500"
        >
          {MONTH_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {error && (
        <div className="rounded-lg bg-rose-50 border border-rose-100 p-3 text-sm text-rose-700">{error}</div>
      )}

      {!loading && data && data.totalPages === 0 && (
        <div className="border border-dashed border-gray-200 rounded-xl py-16 px-6 text-center">
          <p className="text-sm font-medium text-gray-500">No required pages configured</p>
          <p className="text-xs text-gray-400 mt-1">Add required pages in the Coverage Pages tab first.</p>
        </div>
      )}

      {!loading && data && data.totalPages > 0 && !hasActivity && (
        <div className="border border-dashed border-gray-200 rounded-xl py-16 px-6 text-center">
          <p className="text-sm font-medium text-gray-500">No coverage events in {monthLabel}</p>
          <p className="text-xs text-gray-400 mt-1">Points appear here when bidders visit uncovered pages.</p>
        </div>
      )}

      {!loading && data && data.totalPages > 0 && hasActivity && (
        <div className="space-y-3">
          {/* Winner banner */}
          {winner && winner.events > 0 && (
            <div className="rounded-xl bg-gradient-to-r from-amber-50 to-yellow-50 border border-amber-200 px-5 py-4 flex items-center gap-4">
              <div className="text-3xl">🏆</div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold uppercase tracking-wider text-amber-700 mb-0.5">
                  {monthLabel} Leader
                </div>
                <div className="text-base font-bold text-gray-900 truncate">{winner.name}</div>
                <div className="text-xs text-amber-700 mt-0.5">
                  Covered {winner.events} uncovered page{winner.events !== 1 ? "s" : ""} this month
                </div>
              </div>
              <div className="text-3xl font-black text-amber-500 shrink-0 tabular-nums">{winner.events}</div>
            </div>
          )}

          {/* Ranked cards */}
          {data.results.map((entry, idx) => {
            const isWinner = idx === 0 && entry.events > 0;
            const medal = idx < 3 && entry.events > 0 ? MEDALS[idx] : null;

            return (
              <div
                key={entry.id}
                className={`bg-white border rounded-xl px-5 py-4 flex items-center gap-4 ${isWinner ? "border-amber-200 shadow-sm" : "border-gray-200"}`}
              >
                {/* Rank */}
                <div className="w-8 text-center shrink-0">
                  {medal
                    ? <span className="text-xl">{medal}</span>
                    : <span className="text-sm font-bold text-gray-300">#{idx + 1}</span>
                  }
                </div>

                {/* Name / details */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-gray-900">{entry.name}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium border ${
                      entry.role === "admin"
                        ? "bg-gray-100 text-gray-500 border-gray-200"
                        : "bg-teal-50 text-teal-700 border-teal-100"
                    }`}>{entry.role}</span>
                  </div>
                  <div className="text-xs text-gray-400 truncate mt-0.5">{entry.email}</div>

                  {/* Bar relative to top scorer */}
                  <div className="mt-2.5 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                    <div
                      className="h-1.5 rounded-full bg-teal-500 transition-all"
                      style={{ width: `${entry.relativePct}%` }}
                    />
                  </div>
                </div>

                {/* Event count */}
                <div className={`shrink-0 text-xl font-black tabular-nums ${entry.events === 0 ? "text-gray-300" : "text-teal-600"}`}>
                  {entry.events}
                </div>
              </div>
            );
          })}

          <p className="text-xs text-gray-400 text-center pt-1">
            Score = number of times a bidder visited a required page that had been uncovered for at least 1 hour.
          </p>
        </div>
      )}

      {loading && (
        <div className="bg-white border border-gray-200 rounded-xl p-12 text-center text-sm text-gray-400">
          Loading…
        </div>
      )}
    </div>
  );
}
