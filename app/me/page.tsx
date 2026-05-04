"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OverviewPanel } from "@/components/OverviewPanel";
import type { AccountData, OverviewRange, ProposalData } from "@/lib/overview-types";

type CoveragePayload = {
  member: { id: string; name: string };
  coveragePct: number;
  totals: { total: number; visited: number; unvisited: number };
  unvisited: { id: string; name: string; url: string }[];
};

type Note = {
  id: string;
  body: string;
  createdAt: string;
  readAt: string | null;
  author: { id: string; name: string } | null;
  proposal: { id: string; jobTitle: string | null; jobUrl: string | null } | null;
};
type NotesPayload = {
  member: { id: string; name: string };
  unreadCount: number;
  notes: Note[];
};

type MeTab = "overview" | "coverage" | "notes" | "untracked";

const iconProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  className: "w-[18px] h-[18px] shrink-0",
};
const IconHome = () => (
  <svg {...iconProps}>
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <polyline points="9 22 9 12 15 12 15 22" />
  </svg>
);
const IconCompass = () => (
  <svg {...iconProps}>
    <circle cx="12" cy="12" r="10" />
    <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
  </svg>
);
const IconMessage = () => (
  <svg {...iconProps}>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);
const IconSignOut = () => (
  <svg {...iconProps}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);
const IconFileX = () => (
  <svg {...iconProps}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="10" y1="13" x2="14" y2="17" />
    <line x1="14" y1="13" x2="10" y2="17" />
  </svg>
);


export default function MePage() {
  const [accounts, setAccounts] = useState<AccountData[] | null>(null);
  const [coverage, setCoverage] = useState<CoveragePayload | null>(null);
  const [notes, setNotes] = useState<NotesPayload | null>(null);
  const [weekStats, setWeekStats] = useState<{
    last7: { sent: number; viewed: number; interviewed: number; hired: number; viewRate: number; interviewRate: number; hireRate: number };
    prev7: { sent: number; viewed: number; interviewed: number; hired: number; viewRate: number; interviewRate: number; hireRate: number };
  } | null>(null);
  const [showWeekCompare, setShowWeekCompare] = useState(false);
  const [overviewRange, setOverviewRange] = useState<OverviewRange>("7d");
  const [selectedAccountId, setSelectedAccountId] = useState<string>("all");
  const [activeTab, setActiveTab] = useState<MeTab>("overview");
  const [markingRead, setMarkingRead] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadCoverage = useCallback(async (accountId?: string, accountsList?: AccountData[] | null) => {
    let url = "/api/me/coverage";
    const id = accountId ?? selectedAccountId;
    const list = accountsList ?? accounts;
    if (id !== "all" && list) {
      const account = list.find((a) => a.id === id);
      if (account?.freelancerId) url += `?freelancerId=${encodeURIComponent(account.freelancerId)}`;
    } else if (list?.length === 1 && list[0].freelancerId) {
      url += `?freelancerId=${encodeURIComponent(list[0].freelancerId)}`;
    }
    const res = await fetch(url, { cache: "no-store" });
    if (res.status === 401) {
      window.location.href = "/me/login";
      return;
    }
    if (res.ok) setCoverage(await res.json());
  }, [selectedAccountId, accounts]);

    const loadAccounts = useCallback(async () => {
    const res = await fetch("/api/me/accounts", { cache: "no-store" });
    if (res.status === 401) {
      window.location.href = "/me/login";
      return;
    }
    if (res.ok) {
      const data = await res.json();
      setAccounts(data);
      // Reload coverage with the freshly loaded accounts list so the
      // first render uses account-level coverage, not member-level.
      loadCoverage(undefined, data);
    }
  }, [loadCoverage]);

  const loadNotes = useCallback(async () => {
    const res = await fetch("/api/me/notes", { cache: "no-store" });
    if (res.status === 401) {
      window.location.href = "/me/login";
      return;
    }
    if (res.ok) setNotes(await res.json());
  }, []);

  const loadStats = useCallback(async (accountId: string) => {
    const params = new URLSearchParams();
    if (accountId !== "all") params.set("accountId", accountId);
    
    fetch(`/api/me/stats?${params}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.windows) {
          setWeekStats({ last7: data.windows.last7, prev7: data.windows.prev7 });
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadAccounts();
    loadCoverage();
    loadNotes();
  }, [loadAccounts, loadCoverage, loadNotes]);

  useEffect(() => {
    loadStats(selectedAccountId);
  }, [selectedAccountId, loadStats]);

  useEffect(() => {
    if (accounts) loadCoverage();
  }, [selectedAccountId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function tick() {
      if (document.visibilityState === "visible") loadCoverage();
    }
    pollTimer.current = setInterval(tick, 15000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [loadCoverage]);

  async function markNoteRead(id: string) {
    setMarkingRead(id);
    try {
      await fetch(`/api/me/notes/${id}`, { method: "PATCH" });
      await loadNotes();
    } finally {
      setMarkingRead(null);
    }
  }

  async function signOut() {
    await fetch("/api/me/logout", { method: "POST" });
    window.location.href = "/me/login";
  }

  // TeamMember name comes from notes/coverage; accounts[*].name is the Upwork profile name.
  const memberName = notes?.member.name || coverage?.member.name || "";

  const myAccounts = useMemo(
    () =>
      (accounts ?? []).filter(
        (a) =>
          a.snapshots.length > 0 ||
          a.proposals.length > 0 ||
          (((a.alertCounts?.messages ?? 0) +
            (a.alertCounts?.invites ?? 0) +
            (a.alertCounts?.offers ?? 0)) > 0),
      ),
    [accounts],
  );

  const scopedAccounts = useMemo(
    () =>
      selectedAccountId === "all"
        ? myAccounts
        : myAccounts.filter((a) => a.id === selectedAccountId),
    [myAccounts, selectedAccountId],
  );

  const untrackedProposals = useMemo<ProposalData[]>(
    () =>
      scopedAccounts
        .flatMap((a) => a.proposals)
        .filter((p) => !p.submittedViaExtension && !p.coverLetter)
        .sort((a, b) => new Date(b.submittedAt || b.createdAt).getTime() - new Date(a.submittedAt || a.createdAt).getTime()),
    [scopedAccounts],
  );

  const TABS: { id: MeTab; label: string; icon: React.ReactNode; count: number | null }[] = [
    { id: "overview", label: "Overview", icon: <IconHome />, count: null },
    {
      id: "coverage",
      label: "Pages to open",
      icon: <IconCompass />,
      count: coverage?.totals.unvisited ?? null,
    },
    {
      id: "notes",
      label: "Coaching notes",
      icon: <IconMessage />,
      count: notes?.unreadCount ?? null,
    },
    {
      id: "untracked",
      label: "Unscanned Proposals",
      icon: <IconFileX />,
      count: untrackedProposals.length > 0 ? untrackedProposals.length : null,
    },
  ];
  const activeTabLabel = TABS.find((t) => t.id === activeTab)?.label ?? "Overview";

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 flex">
      <aside className="w-60 bg-white border-r border-gray-200 flex flex-col sticky top-0 h-screen shrink-0">
        <div className="h-14 px-5 flex items-center border-b border-gray-200">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-teal-500 text-white flex items-center justify-center text-xs font-bold">
              UT
            </div>
            <span className="text-sm font-semibold text-gray-900 tracking-tight">Upwork Tracker</span>
          </div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive
                    ? "bg-teal-50 text-teal-700 font-medium"
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                }`}
              >
                <span className={isActive ? "text-teal-600" : "text-gray-400"}>{tab.icon}</span>
                <span className="flex-1 text-left">{tab.label}</span>
                {tab.count != null && tab.count > 0 && (
                  <span
                    className={`text-[11px] px-1.5 py-0.5 rounded-full font-medium ${
                      isActive ? "bg-teal-100 text-teal-700" : "bg-gray-100 text-gray-500"
                    }`}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
        {myAccounts.length > 0 && (
          <div className="p-3 border-t border-gray-200">
            <label className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold px-1">
              Account
            </label>
            <select
              value={selectedAccountId}
              onChange={(e) => setSelectedAccountId(e.target.value)}
              className="w-full mt-1.5 text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-teal-500 cursor-pointer"
            >
              {myAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="p-3 border-t border-gray-200">
          <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold px-2 mb-1.5">
            Signed in
          </div>
          <div className="px-2 text-sm font-medium text-gray-900 truncate">{memberName || "—"}</div>
          <button
            onClick={signOut}
            className="mt-2 w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors text-rose-600 hover:bg-rose-50"
          >
            <span className="text-rose-400">
              <IconSignOut />
            </span>
            <span className="flex-1 text-left">Sign out</span>
          </button>
        </div>
      </aside>

      <main className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-10 bg-white/80 backdrop-blur border-b border-gray-200 h-14 flex items-center justify-between px-6">
          <div>
            <h1 className="text-sm font-semibold text-gray-900">{activeTabLabel}</h1>
            <p className="text-[11px] text-gray-400">
              {memberName ? `Signed in as ${memberName}` : ""}
            </p>
          </div>
        </header>

        <div className="flex flex-col gap-2 mx-6 mt-4 empty:hidden">
          {coverage && coverage.coveragePct < 80 && (
            <div className="px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800 flex items-center gap-2">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 shrink-0">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/>
                <line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
              Your page coverage is {coverage.coveragePct}% — open the required pages to stay on track.
            </div>
          )}
          {untrackedProposals.length > 0 && (
            <div className="px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800 flex items-center gap-2">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 shrink-0">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/>
                <line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
              You have {untrackedProposals.length} unscanned proposal{untrackedProposals.length !== 1 ? "s" : ""} — open them on Upwork with the extension active so cover letters and client details are captured.
            </div>
          )}
        </div>

        <div className="flex-1 px-6 pb-6 overflow-auto">
          {activeTab === "overview" &&
            (accounts === null ? (
              <div className="py-6 text-sm text-gray-500">Loading…</div>
            ) : (
              <>
                <OverviewPanel
                  accounts={scopedAccounts}
                  range={overviewRange}
                  onRangeChange={setOverviewRange}
                  showAccountComparison={selectedAccountId === "all" && myAccounts.length > 1}
                />
                {weekStats && (
                  <div className="mt-4">
                    <button
                      onClick={() => setShowWeekCompare((v) => !v)}
                      className="text-xs font-medium text-teal-600 hover:text-teal-700 flex items-center gap-1"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                        {showWeekCompare
                          ? <polyline points="18 15 12 9 6 15" />
                          : <polyline points="6 9 12 15 18 9" />}
                      </svg>
                      {showWeekCompare ? "Hide" : "Show"} week-vs-week comparison
                    </button>
                    {showWeekCompare && (
                      <div className="mt-3 bg-white border border-gray-200 rounded-xl p-5">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">This week vs last week</h3>
                          <div className="flex items-center gap-4 text-[10px] font-medium uppercase tracking-widest text-gray-400">
                            <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-sm bg-gray-300" /> Previous</div>
                            <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-sm bg-teal-500" /> Current</div>
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {/* Main Volume Metrics */}
                          {(["sent", "viewed", "interviewed", "hired"] as const).map((key) => {
                            const curr = weekStats.last7[key];
                            const prev = weekStats.prev7[key];
                            const max = Math.max(curr, prev, 5);
                            const delta = prev === 0 ? (curr > 0 ? 100 : 0) : Math.round(((curr - prev) / prev) * 100);
                            
                            const colorClass = 
                              key === "sent" ? "text-blue-600 bg-blue-50 border-blue-100" :
                              key === "viewed" ? "text-purple-600 bg-purple-50 border-purple-100" :
                              key === "interviewed" ? "text-amber-600 bg-amber-50 border-amber-100" :
                              "text-teal-600 bg-teal-50 border-teal-100";
                            
                            const barColor = 
                              key === "sent" ? "bg-blue-500" :
                              key === "viewed" ? "bg-purple-500" :
                              key === "interviewed" ? "bg-amber-500" :
                              "bg-teal-500";

                            return (
                              <div key={key} className="bg-white border border-gray-100 rounded-xl p-4 flex flex-col gap-3 shadow-sm">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${colorClass}`}>
                                      {key}
                                    </span>
                                  </div>
                                  {prev === 0 && curr > 0 ? (
                                    <span className="text-[10px] font-bold text-green-600 bg-green-50 px-2 py-0.5 rounded-full uppercase tracking-tighter">New Activity</span>
                                  ) : delta !== 0 && (
                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-0.5 ${delta > 0 ? "text-green-600 bg-green-50" : "text-rose-600 bg-rose-50"}`}>
                                      {delta > 0 ? "↑" : "↓"} {Math.abs(delta)}%
                                    </span>
                                  )}
                                </div>

                                <div className="flex items-end justify-between gap-4">
                                  <div className="flex flex-col">
                                    <span className="text-2xl font-bold text-gray-900 leading-none">{curr}</span>
                                    <span className="text-[10px] text-gray-400 mt-1">vs {prev} last week</span>
                                  </div>
                                  
                                  <div className="flex-1 max-w-[120px] flex flex-col gap-1.5 pb-1">
                                    <div className="h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
                                      <div className={`h-full transition-all duration-500 ${barColor}`} style={{ width: `${(curr / max) * 100}%` }} />
                                    </div>
                                    <div className="h-1 w-full bg-gray-50 rounded-full overflow-hidden">
                                      <div className="h-full bg-gray-300 transition-all duration-500" style={{ width: `${(prev / max) * 100}%` }} />
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {/* Conversion Rates */}
                        <div className="mt-4 grid grid-cols-3 gap-3">
                          {(["viewRate", "interviewRate", "hireRate"] as const).map((key) => {
                            const label = key === "viewRate" ? "View rate" : key === "interviewRate" ? "Interview rate" : "Hire rate";
                            const curr = weekStats.last7[key];
                            const prev = weekStats.prev7[key];
                            const diff = Math.round((curr - prev) * 10) / 10;
                            
                            return (
                              <div key={key} className="rounded-xl border border-gray-100 bg-gray-50/50 p-3 flex flex-col items-center">
                                <div className="text-[9px] uppercase tracking-widest text-gray-400 font-bold mb-1">{label}</div>
                                <div className="text-lg font-bold text-gray-800">{curr}%</div>
                                <div className="flex items-center gap-1.5 mt-0.5">
                                  <span className="text-[10px] text-gray-400">prev {prev}%</span>
                                  {diff !== 0 && (
                                    <span className={`text-[10px] font-bold ${diff > 0 ? "text-green-600" : "text-rose-600"}`}>
                                      {diff > 0 ? "+" : ""}{diff}%
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            ))}

          {activeTab === "coverage" && (
            <section className="mt-6 bg-white border border-gray-200 rounded-xl p-6">
              <h2 className="text-lg font-semibold text-gray-900">
                Pages to open to keep your stats accurate
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                Opening these pages updates your personal stats automatically.
              </p>

              {!coverage ? (
                <div className="mt-4 text-sm text-gray-500">Loading…</div>
              ) : (
                <>
                  {coverage.coveragePct < 80 && (
                    <div className="mt-4 rounded-lg bg-yellow-50 border border-yellow-200 px-4 py-3 text-sm text-yellow-800">
                      Your coverage is below 80%. Open the pages below to keep your stats accurate.
                    </div>
                  )}

                  <div className="my-5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-gray-500 uppercase tracking-wider">Coverage</span>
                      <span className="text-gray-600">
                        {coverage.totals.visited} / {coverage.totals.total}
                      </span>
                    </div>
                    <div className="mt-2 h-2 rounded-full bg-gray-100 overflow-hidden">
                      <div
                        className="h-2 rounded-full bg-teal-500 transition-all"
                        style={{ width: `${coverage.coveragePct}%` }}
                      />
                    </div>
                    <div className="mt-1.5 text-right text-sm font-semibold text-gray-900">
                      {coverage.coveragePct}%
                    </div>
                  </div>

                  {coverage.unvisited.length === 0 ? (
                    <div className="rounded-lg bg-green-50 border border-green-100 p-4 text-sm text-green-700 text-center">
                      You&apos;re all caught up.
                    </div>
                  ) : (
                    <ul className="space-y-2">
                      {coverage.unvisited.map((page) => (
                        <li
                          key={page.id}
                          className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 p-3 text-sm"
                        >
                          <span className="font-medium text-gray-700">{page.name}</span>
                          <a
                            href={page.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="shrink-0 px-3 py-1.5 bg-teal-500 hover:bg-teal-600 text-white text-xs font-medium rounded-lg transition-colors shadow-sm"
                          >
                            Open on Upwork
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </section>
          )}

          {activeTab === "notes" && (
            <section className="mt-6 bg-white border border-gray-200 rounded-xl p-6">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">Coaching notes</h2>
                {notes && notes.unreadCount > 0 && (
                  <span className="rounded-full bg-teal-500 px-2.5 py-0.5 text-[11px] font-medium text-white">
                    {notes.unreadCount} unread
                  </span>
                )}
              </div>
              {!notes ? (
                <div className="mt-4 text-sm text-gray-500">Loading…</div>
              ) : notes.notes.length === 0 ? (
                <p className="mt-4 text-sm text-gray-500">No notes yet.</p>
              ) : (
                <ul className="mt-5 space-y-3">
                  {notes.notes.map((n) => (
                    <li
                      key={n.id}
                      className={`rounded-lg border p-4 text-sm ${
                        n.readAt ? "border-gray-200 bg-white" : "border-teal-200 bg-teal-50"
                      }`}
                    >
                      <div className="mb-2 flex items-center justify-between text-xs text-gray-500">
                        <span className="font-medium text-gray-700">{n.author?.name || "Admin"}</span>
                        <span>{new Date(n.createdAt).toLocaleString()}</span>
                      </div>
                      <p className="whitespace-pre-wrap text-gray-900">{n.body}</p>
                      {n.proposal && (
                        <div className="mt-2 text-xs text-gray-500">
                          On proposal:{" "}
                          {n.proposal.jobUrl ? (
                            <a
                              href={n.proposal.jobUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-teal-600 hover:underline"
                            >
                              {n.proposal.jobTitle || "(untitled)"}
                            </a>
                          ) : (
                            n.proposal.jobTitle || "(untitled)"
                          )}
                        </div>
                      )}
                       {!n.readAt && (
                        <button
                          disabled={markingRead === n.id}
                          onClick={() => markNoteRead(n.id)}
                          className={`mt-3 text-xs font-medium flex items-center gap-1.5 transition-colors ${
                            markingRead === n.id ? "text-gray-400" : "text-teal-700 hover:text-teal-800"
                          }`}
                        >
                          {markingRead === n.id ? (
                            <>
                              <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                              </svg>
                              Marking...
                            </>
                          ) : (
                            "Mark as read"
                          )}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {activeTab === "untracked" && (
            <section className="mt-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-base font-semibold text-gray-900">Unscanned Proposals</h2>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Proposals synced from your Upwork list but not captured by the extension at submission time — cover letter and client details may be missing.
                  </p>
                </div>
                <span className="text-xs text-gray-400">{untrackedProposals.length} total</span>
              </div>

              {untrackedProposals.length === 0 ? (
                <div className="bg-white border border-gray-200 rounded-xl py-16 text-center text-gray-400 text-sm">
                  All your proposals were scanned via the extension
                </div>
              ) : (
                <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto shadow-sm">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 bg-gray-50">
                        <th className="text-left px-4 py-3 text-gray-500 font-medium text-xs uppercase tracking-wide">Job Title</th>
                        <th className="text-left px-4 py-3 text-gray-500 font-medium text-xs uppercase tracking-wide">Section</th>
                        <th className="text-left px-4 py-3 text-gray-500 font-medium text-xs uppercase tracking-wide">Profile</th>
                        <th className="text-left px-4 py-3 text-gray-500 font-medium text-xs uppercase tracking-wide">Submitted</th>
                      </tr>
                    </thead>
                    <tbody>
                      {untrackedProposals.map((p) => (
                        <tr key={p.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-3 max-w-md">
                            {p.jobUrl ? (
                              <a href={p.jobUrl} target="_blank" rel="noopener noreferrer" className="text-teal-600 font-medium hover:underline truncate block">
                                {p.jobTitle || "Untitled"}
                              </a>
                            ) : (
                              <span className="text-gray-700 font-medium truncate block">{p.jobTitle || "Untitled"}</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-500">{p.section || "—"}</td>
                          <td className="px-4 py-3 text-xs text-gray-500">{p.profileUsed || "—"}</td>
                          <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                            {new Date(p.submittedAt || p.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
