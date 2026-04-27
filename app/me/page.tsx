"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OverviewPanel } from "@/components/OverviewPanel";
import type { AccountData, OverviewRange } from "@/lib/overview-types";

type CoverageItem = {
  id: string;
  entityType: "offer" | "message_thread" | "proposal";
  entityId: string;
  openUrl: string | null;
  reasonTags: string[];
  referencedAt: string;
  priority: number;
};
type CoveragePayload = {
  member: { id: string; name: string };
  coveragePct: number;
  totals: { referenced: number; captured: number; uncovered: number };
  items: CoverageItem[];
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

type MeTab = "overview" | "coverage" | "notes";

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

const ENTITY_LABEL: Record<CoverageItem["entityType"], string> = {
  offer: "Offer",
  message_thread: "Message thread",
  proposal: "Proposal",
};

function reasonText(item: CoverageItem): string {
  const t = item.reasonTags;
  if (item.entityType === "offer") return "A client sent you an offer.";
  if (item.entityType === "message_thread") {
    if (t.includes("needs_reply")) return "A client is waiting on your reply.";
    if (t.includes("unread")) return "You have a new message.";
    return "Open the thread to keep your stats accurate.";
  }
  if (t.includes("offer_stage")) return "Your proposal advanced to an offer.";
  if (t.includes("interview_stage")) return "The client started an interview.";
  if (t.includes("viewed")) return "The client viewed your proposal.";
  return "Your latest proposal needs a quick open to refresh.";
}

export default function MePage() {
  const [accounts, setAccounts] = useState<AccountData[] | null>(null);
  const [coverage, setCoverage] = useState<CoveragePayload | null>(null);
  const [notes, setNotes] = useState<NotesPayload | null>(null);
  const [overviewRange, setOverviewRange] = useState<OverviewRange>("30d");
  const [selectedAccountId, setSelectedAccountId] = useState<string>("all");
  const [activeTab, setActiveTab] = useState<MeTab>("overview");
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadAccounts = useCallback(async () => {
    const res = await fetch("/api/me/accounts", { cache: "no-store" });
    if (res.status === 401) {
      window.location.href = "/me/login";
      return;
    }
    if (res.ok) setAccounts(await res.json());
  }, []);

  const loadCoverage = useCallback(async () => {
    const res = await fetch("/api/me/coverage", { cache: "no-store" });
    if (res.status === 401) {
      window.location.href = "/me/login";
      return;
    }
    if (res.ok) setCoverage(await res.json());
  }, []);

  const loadNotes = useCallback(async () => {
    const res = await fetch("/api/me/notes", { cache: "no-store" });
    if (res.status === 401) {
      window.location.href = "/me/login";
      return;
    }
    if (res.ok) setNotes(await res.json());
  }, []);

  useEffect(() => {
    loadAccounts();
    loadCoverage();
    loadNotes();
  }, [loadAccounts, loadCoverage, loadNotes]);

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
    await fetch(`/api/me/notes/${id}`, { method: "PATCH" });
    loadNotes();
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
          a.jobs.length > 0 ||
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

  const TABS: { id: MeTab; label: string; icon: React.ReactNode; count: number | null }[] = [
    { id: "overview", label: "Overview", icon: <IconHome />, count: null },
    {
      id: "coverage",
      label: "Pages to open",
      icon: <IconCompass />,
      count: coverage?.totals.uncovered ?? null,
    },
    {
      id: "notes",
      label: "Coaching notes",
      icon: <IconMessage />,
      count: notes?.unreadCount ?? null,
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
        <header className="sticky top-0 z-10 bg-white/80 backdrop-blur border-b border-gray-200 h-14 flex items-center justify-between px-6">
          <div>
            <h1 className="text-sm font-semibold text-gray-900">{activeTabLabel}</h1>
            <p className="text-[11px] text-gray-400">
              {memberName ? `Signed in as ${memberName}` : ""}
            </p>
          </div>
        </header>

        <div className="flex-1 px-6 pb-6 overflow-auto">
          {activeTab === "overview" &&
            (accounts === null ? (
              <div className="py-6 text-sm text-gray-500">Loading…</div>
            ) : (
              <OverviewPanel
                accounts={scopedAccounts}
                range={overviewRange}
                onRangeChange={setOverviewRange}
                showAccountComparison={selectedAccountId === "all" && myAccounts.length > 1}
              />
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
                  <div className="my-5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-gray-500 uppercase tracking-wider">Coverage</span>
                      <span className="text-gray-600">
                        {coverage.totals.captured} / {coverage.totals.referenced}
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

                  {coverage.items.length === 0 ? (
                    <div className="rounded-lg bg-green-50 border border-green-100 p-4 text-sm text-green-700 text-center">
                      You&apos;re all caught up.
                    </div>
                  ) : (
                    <ul className="space-y-2">
                      {coverage.items.map((item) => (
                        <li
                          key={item.id}
                          className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 p-3 text-sm"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="rounded-full bg-gray-100 text-gray-700 px-2.5 py-0.5 text-[11px] font-medium">
                                {ENTITY_LABEL[item.entityType]}
                              </span>
                              <span className="truncate text-gray-700">{reasonText(item)}</span>
                            </div>
                          </div>
                          {item.openUrl ? (
                            <a
                              href={item.openUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="shrink-0 px-3 py-1.5 bg-teal-500 hover:bg-teal-600 text-white text-xs font-medium rounded-lg transition-colors shadow-sm"
                            >
                              Open on Upwork
                            </a>
                          ) : null}
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
                          onClick={() => markNoteRead(n.id)}
                          className="mt-3 text-xs font-medium text-teal-700 hover:text-teal-800"
                        >
                          Mark as read
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
    </div>
  );
}
