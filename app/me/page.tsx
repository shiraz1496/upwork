"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { OverviewPanel } from "@/components/OverviewPanel";
import { FreelancerProfileCard } from "@/components/FreelancerProfileCard";
import { JobsView } from "@/components/me/JobsView";
import { ProposalsView, type ProposalSeed } from "@/components/me/ProposalsView";
import { RepliesView } from "@/components/me/RepliesView";
import { UpworkView } from "@/components/me/UpworkView";
import type { AccountData } from "@/lib/overview-types";

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

// Coverage ("pages to open"), unscanned proposals and the extension guide were removed with
// the extension: nothing records Upwork browsing any more (MCP migration, Phase G).
type MeTab = "overview" | "profile" | "upwork" | "jobs" | "proposals" | "replies" | "notes";

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
const IconMessage = () => (
  <svg {...iconProps}>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);
const IconUser = () => (
  <svg {...iconProps}>
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);
const IconSignOut = () => (
  <svg {...iconProps}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);
const IconLink = () => (
  <svg {...iconProps}>
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);
const IconSearch = () => (
  <svg {...iconProps}>
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);
const IconFile = () => (
  <svg {...iconProps}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="8" y1="13" x2="16" y2="13" />
    <line x1="8" y1="17" x2="13" y2="17" />
  </svg>
);
const IconInbox = () => (
  <svg {...iconProps}>
    <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
    <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
  </svg>
);

export default function MePage() {
  // useSearchParams needs a Suspense boundary on a prerendered page.
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50 p-6 text-sm text-gray-500">Loading…</div>}>
      <MeDashboard />
    </Suspense>
  );
}

function MeDashboard() {
  const router = useRouter();
  // Upwork redirects back here with ?upwork=<result> after the connect flow.
  const upworkCallback = useSearchParams().get("upwork");
  const [accounts, setAccounts] = useState<AccountData[] | null>(null);
  const [notes, setNotes] = useState<NotesPayload | null>(null);
  const [weekStats, setWeekStats] = useState<{
    last7: { sent: number; viewed: number; interviewed: number; hired: number; viewRate: number; interviewRate: number; hireRate: number };
    prev7: { sent: number; viewed: number; interviewed: number; hired: number; viewRate: number; interviewRate: number; hireRate: number };
    // Metrics with no data source ("viewed" | "hired") — shown as "—", never 0.
    unavailable: string[];
  } | null>(null);
  const [showWeekCompare, setShowWeekCompare] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<string>("all");
  const [activeTab, setActiveTab] = useState<MeTab>(upworkCallback ? "upwork" : "overview");
  // The job a bidder picked in the Jobs tab to start a proposal for.
  const [proposalSeed, setProposalSeed] = useState<ProposalSeed | null>(null);
  const [markingRead, setMarkingRead] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const loadAccounts = useCallback(async () => {
    const res = await fetch("/api/me/accounts", { cache: "no-store" });
    if (res.status === 401) {
      window.location.href = "/me/login";
      return;
    }
    if (res.ok) setAccounts(await res.json());
  }, []);

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
          setWeekStats({ last7: data.windows.last7, prev7: data.windows.prev7, unavailable: data.unavailable ?? [] });
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads the bidder's data on mount (existing pattern)
    loadAccounts();
    loadNotes();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadStats(selectedAccountId);
  }, [selectedAccountId, loadStats]);

  // Drop ?upwork=… from the address bar once the result has been picked up.
  useEffect(() => {
    if (upworkCallback) router.replace("/me");
  }, [upworkCallback, router]);

  // Called by the new tabs after something changed that the Overview numbers depend on.
  const refreshOverview = useCallback(() => {
    loadAccounts();
    loadStats(selectedAccountId);
  }, [loadAccounts, loadStats, selectedAccountId]);

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

  // TeamMember name comes from the notes payload; accounts[*].name is the Upwork profile name.
  const memberName = notes?.member.name || "";

  // /api/me/accounts already returns only this bidder's accounts; a newly connected
  // account with no proposals yet still belongs on the page.
  const myAccounts = useMemo(() => accounts ?? [], [accounts]);

  const scopedAccounts = useMemo(
    () =>
      selectedAccountId === "all"
        ? myAccounts
        : myAccounts.filter((a) => a.id === selectedAccountId),
    [myAccounts, selectedAccountId],
  );

  const TABS: { id: MeTab; label: string; icon: React.ReactNode; count: number | null }[] = [
    { id: "overview", label: "Overview", icon: <IconHome />, count: null },
    { id: "profile", label: "Profile", icon: <IconUser />, count: null },
    { id: "upwork", label: "Upwork connection", icon: <IconLink />, count: null },
    { id: "jobs", label: "Find jobs", icon: <IconSearch />, count: null },
    { id: "proposals", label: "My proposals", icon: <IconFile />, count: null },
    { id: "replies", label: "Client replies", icon: <IconInbox />, count: null },
    {
      id: "notes",
      label: "Coaching notes",
      icon: <IconMessage />,
      count: notes?.unreadCount ?? null,
    },
  ];
  const activeTabLabel = TABS.find((t) => t.id === activeTab)?.label ?? "Overview";

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 flex overflow-x-clip">
      <aside className={`fixed lg:sticky top-0 left-0 h-screen w-64 lg:w-60 bg-white border-r border-gray-200 flex flex-col shrink-0 transition-transform duration-200 z-50 lg:z-auto ${sidebarOpen ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0`}>
        <div className="h-14 px-5 flex items-center border-b border-gray-200">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-teal-500 text-white flex items-center justify-center text-xs font-bold">
              UT
            </div>
            <span className="text-sm font-semibold text-gray-900 tracking-tight">Upwork Tracker</span>
          </div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => { setActiveTab(tab.id); setSidebarOpen(false); }}
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
        {myAccounts.length > 1 && (
          <div className="p-3 border-t border-gray-200">
            <label className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold px-1">
              Account
            </label>
            <select
              value={selectedAccountId}
              onChange={(e) => setSelectedAccountId(e.target.value)}
              className="w-full mt-1.5 text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-teal-500 cursor-pointer"
            >
              <option value="all">All accounts</option>
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
        <header className="sticky top-0 z-10 bg-white/80 backdrop-blur border-b border-gray-200 h-14 flex items-center justify-between px-4 lg:px-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
              aria-label="Open menu"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
            <div>
              <h1 className="text-sm font-semibold text-gray-900">{activeTabLabel}</h1>
              <p className="text-[11px] text-gray-400">
                {memberName ? `Signed in as ${memberName}` : ""}
              </p>
            </div>
          </div>
        </header>

        <div className="flex-1 px-4 lg:px-6 pb-6 overflow-auto">
          {activeTab === "overview" &&
            (accounts === null ? (
              <div className="py-6 text-sm text-gray-500">Loading…</div>
            ) : (
              <>
                <OverviewPanel
                  accounts={scopedAccounts}
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
                            if (weekStats.unavailable.includes(key)) {
                              return (
                                <div key={key} className="bg-white border border-gray-100 rounded-xl p-4 flex flex-col gap-3 shadow-sm">
                                  <span className="self-start px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border text-gray-500 bg-gray-50 border-gray-200">
                                    {key}
                                  </span>
                                  <div className="flex flex-col">
                                    <span className="text-2xl font-bold text-gray-400 leading-none">—</span>
                                    <span className="text-[10px] text-gray-400 mt-1">unavailable</span>
                                  </div>
                                </div>
                              );
                            }
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
                            const source = key === "viewRate" ? "viewed" : key === "hireRate" ? "hired" : "";
                            if (weekStats.unavailable.includes(source)) {
                              return (
                                <div key={key} className="rounded-xl border border-gray-100 bg-gray-50/50 p-3 flex flex-col items-center">
                                  <div className="text-[9px] uppercase tracking-widest text-gray-400 font-bold mb-1">{label}</div>
                                  <div className="text-lg font-bold text-gray-400">—</div>
                                  <div className="text-[10px] text-gray-400 mt-0.5">unavailable</div>
                                </div>
                              );
                            }
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

          {activeTab === "profile" && (
            <div className="py-6">
              {scopedAccounts.length === 1 ? (
                <FreelancerProfileCard
                  profile={scopedAccounts[0].profile}
                  accountName={scopedAccounts[0].name}
                />
              ) : (
                <div className="rounded-xl border border-dashed border-gray-300 bg-white p-6 text-sm text-gray-500">
                  Select a single account from the dropdown above to view its freelancer profile.
                </div>
              )}
            </div>
          )}

          {activeTab === "upwork" && <UpworkView callbackCode={upworkCallback} onChanged={refreshOverview} />}

          {activeTab === "jobs" && (
            <JobsView
              onGoToUpwork={() => setActiveTab("upwork")}
              onStartProposal={(seed) => {
                setProposalSeed(seed);
                setActiveTab("proposals");
              }}
            />
          )}

          {activeTab === "proposals" && (
            <ProposalsView seed={proposalSeed} onSeedUsed={() => setProposalSeed(null)} onChanged={refreshOverview} />
          )}

          {activeTab === "replies" && <RepliesView onChanged={refreshOverview} />}

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

        </div>
      </main>

      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/40 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}
    </div>
  );
}
