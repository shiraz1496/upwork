"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { TeamView } from "@/components/admin/TeamView";
import { TeamStatsView } from "@/components/admin/TeamStatsView";
import { AuditView } from "@/components/admin/AuditView";
import { ProfileActivityView } from "@/components/admin/ProfileActivityView";
import { CoveragePagesView } from "@/components/admin/CoveragePagesView";
import { OverviewPanel } from "@/components/OverviewPanel";
import type {
  AccountData,
  SnapshotSummary,
  JobData,
  ProposalData,
  AlertData,
  OverviewRange,
} from "@/lib/overview-types";
import { applyMemberFilter } from "@/lib/overview-aggregation";

// Interfaces are imported from @/lib/overview-types above.

// ─── Constants ───────────────────────────────────────────────────────────────

const COLORS = {
  teal: "#14b8a6",
  blue: "#3b82f6",
  purple: "#8b5cf6",
  amber: "#f59e0b",
  rose: "#f43f5e",
  green: "#22c55e",
  cyan: "#06b6d4",
  orange: "#f97316",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return String(n);
}

function fmtDateTime(d: string): string {
  return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function StarRating({ rating }: { rating: number }) {
  const full = Math.round(rating);
  return (
    <span>
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} style={{ color: i < full ? COLORS.amber : "#d1d5db" }}>★</span>
      ))}
    </span>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

// ─── Inline icons (no dep) ───
const iconProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  className: "w-[18px] h-[18px] shrink-0",
};
const IconHome = () => (<svg {...iconProps}><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>);
const IconBriefcase = () => (<svg {...iconProps}><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>);
const IconFile = () => (<svg {...iconProps}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>);
const IconBell = () => (<svg {...iconProps}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>);
const IconCamera = () => (<svg {...iconProps}><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>);
const IconSend = () => (<svg {...iconProps}><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>);
const IconRefresh = () => (<svg {...iconProps} className="w-4 h-4 shrink-0"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>);
const IconArrowUp = () => (<svg {...iconProps} className="w-3 h-3 shrink-0"><polyline points="18 15 12 9 6 15"/></svg>);
const IconArrowDown = () => (<svg {...iconProps} className="w-3 h-3 shrink-0"><polyline points="6 9 12 15 18 9"/></svg>);
const IconUsers = () => (<svg {...iconProps}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>);
const IconChart = () => (<svg {...iconProps}><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg>);
const IconShield = () => (<svg {...iconProps}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>);
const IconSignOut = () => (<svg {...iconProps}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>);
const IconCompass = () => (<svg {...iconProps}><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>);

function StatCard({ label, value, sub, color, delta }: {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
  delta?: number | null;
}) {
  const up = delta != null && delta > 0;
  const down = delta != null && delta < 0;
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 flex flex-col gap-2 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-gray-500 uppercase tracking-wider font-medium">{label}</span>
        {delta != null && (
          <span className={`inline-flex items-center gap-0.5 text-[11px] font-medium px-1.5 py-0.5 rounded ${
            up ? "bg-green-50 text-green-700" :
            down ? "bg-rose-50 text-rose-700" :
            "bg-gray-50 text-gray-500"
          }`}>
            {up && <IconArrowUp />}
            {down && <IconArrowDown />}
            {Math.abs(delta)}%
          </span>
        )}
      </div>
      <span className="text-2xl font-semibold tracking-tight text-gray-900" style={{ color: color || "#111827" }}>{value}</span>
      {sub && <span className="text-xs text-gray-400">{sub}</span>}
    </div>
  );
}

function Badge({ text, variant }: { text: string; variant: "teal" | "blue" | "purple" | "amber" | "green" | "rose" | "gray" }) {
  const styles: Record<string, string> = {
    teal:   "bg-teal-50 text-teal-700 border border-teal-200",
    blue:   "bg-blue-50 text-blue-700 border border-blue-200",
    purple: "bg-purple-50 text-purple-700 border border-purple-200",
    amber:  "bg-amber-50 text-amber-700 border border-amber-200",
    green:  "bg-green-50 text-green-700 border border-green-200",
    rose:   "bg-rose-50 text-rose-700 border border-rose-200",
    gray:   "bg-gray-100 text-gray-500 border border-gray-200",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${styles[variant]}`}>{text}</span>
  );
}

// ─── Detail Drawer ────────────────────────────────────────────────────────────

function DrawerField({ label, value }: { label: string; value: React.ReactNode }) {
  if (!value && value !== 0) return null;
  return (
    <div>
      <dt className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-0.5">{label}</dt>
      <dd className="text-sm text-gray-800">{value}</dd>
    </div>
  );
}

function JobDrawer({ job, onClose }: { job: JobData; onClose: () => void }) {
  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/30 z-40 transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={job.title}
        className="fixed right-0 top-0 h-full w-full max-w-lg bg-white z-50 shadow-2xl overflow-y-auto flex flex-col"
      >
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-gray-900 leading-snug">{job.title}</h2>
            {job.category && <p className="text-xs text-gray-500 mt-0.5">{job.category}</p>}
          </div>
          <button
            onClick={onClose}
            className="flex-shrink-0 p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Close"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-6 flex flex-col gap-6">
          {/* Quick badges */}
          <div className="flex flex-wrap gap-2">
            {job.jobType && <Badge text={job.jobType} variant="blue" />}
            {job.experienceLevel && <Badge text={job.experienceLevel} variant="purple" />}
            {job.budget && <Badge text={job.budget} variant="amber" />}
            {job.connectsRequired != null && <Badge text={`${job.connectsRequired} connects`} variant="gray" />}
          </div>

          {/* Job Details */}
          <section>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Job Details</h3>
            <dl className="grid grid-cols-2 gap-3">
              <DrawerField label="Budget" value={job.budget} />
              <DrawerField label="Type" value={job.jobType} />
              <DrawerField label="Experience Level" value={job.experienceLevel} />
              <DrawerField label="Location" value={job.jobLocation} />
              <DrawerField label="Connects Required" value={job.connectsRequired} />
              <DrawerField label="Viewed At" value={fmtDateTime(job.viewedAt)} />
            </dl>
          </section>

          {/* Skills */}
          {job.skills && job.skills.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Skills Required</h3>
              <div className="flex flex-wrap gap-1.5">
                {job.skills.map((s, i) => (
                  <span key={i} className="px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded-md border border-gray-200">
                    {s}
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* Client Info */}
          <section>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Client Information</h3>
            <dl className="grid grid-cols-2 gap-3">
              {job.clientRating != null && (
                <div className="col-span-2">
                  <dt className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-0.5">Rating</dt>
                  <dd className="flex items-center gap-2 text-sm">
                    <StarRating rating={job.clientRating} />
                    <span className="font-medium text-gray-800">{job.clientRating}</span>
                    {job.clientReviews != null && <span className="text-gray-400">({job.clientReviews} reviews)</span>}
                  </dd>
                </div>
              )}
              <DrawerField
                label="Verified"
                value={
                  <div className="flex gap-2">
                    {job.clientPaymentVerified && <Badge text="Payment" variant="green" />}
                    {job.clientPhoneVerified && <Badge text="Phone" variant="green" />}
                    {!job.clientPaymentVerified && !job.clientPhoneVerified && <span className="text-gray-400">—</span>}
                  </div>
                }
              />
              <DrawerField label="Location" value={[job.clientCity, job.clientCountry].filter(Boolean).join(", ") || null} />
              <DrawerField label="Total Spent" value={job.clientSpent} />
              <DrawerField label="Total Hires" value={job.clientHires} />
              <DrawerField label="Active Hires" value={job.clientActiveHires} />
              <DrawerField label="Jobs Posted" value={job.clientJobsPosted} />
              <DrawerField label="Open Jobs" value={job.clientOpenJobs} />
              <DrawerField label="Hire Rate" value={job.clientHireRate != null ? `${job.clientHireRate}%` : null} />
              <DrawerField label="Industry" value={job.clientIndustry} />
              <DrawerField label="Company Size" value={job.clientCompanySize} />
              <DrawerField label="Member Since" value={job.clientMemberSince} />
            </dl>
          </section>

          {/* Link */}
          <a
            href={job.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-teal-600 hover:text-teal-700 font-medium"
          >
            Open Job on Upwork
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" />
            </svg>
          </a>
        </div>
      </div>
    </>
  );
}

function ProposalDrawer({ proposal, onClose }: { proposal: ProposalData; onClose: () => void }) {
  const [noteBody, setNoteBody] = useState("");
  const [noteSending, setNoteSending] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [noteSent, setNoteSent] = useState(false);

  async function submitNote(e: React.FormEvent) {
    e.preventDefault();
    if (!proposal.capturedBy) return;
    setNoteSending(true);
    setNoteError(null);
    try {
      const res = await fetch("/api/admin/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientId: proposal.capturedBy.id, proposalId: proposal.id, body: noteBody }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setNoteSent(true);
      setNoteBody("");
    } catch (e) {
      setNoteError(e instanceof Error ? e.message : "Failed");
    } finally {
      setNoteSending(false);
    }
  }

  const sectionVariant = (sec: string | null): "teal" | "blue" | "purple" | "green" | "gray" => {
    if (!sec) return "gray";
    if (sec.toLowerCase().includes("offer")) return "teal";
    if (sec.toLowerCase().includes("invite")) return "purple";
    if (sec.toLowerCase().includes("active")) return "green";
    if (sec.toLowerCase().includes("submitted")) return "blue";
    return "gray";
  };

  return (
    <>
      <div
        className="fixed inset-0 bg-black/30 z-40 transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={proposal.jobTitle ?? "Proposal"}
        className="fixed right-0 top-0 h-full w-full max-w-lg bg-white z-50 shadow-2xl overflow-y-auto flex flex-col"
      >
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-gray-900 leading-snug">{proposal.jobTitle || "Untitled"}</h2>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {proposal.section && <Badge text={proposal.section} variant={sectionVariant(proposal.section)} />}
              {proposal.boosted && (
                <Badge
                  text={proposal.boostStatus || "Boosted"}
                  variant={proposal.boostStatus === "Boost outbid" ? "rose" : "amber"}
                />
              )}
              {proposal.viewedByClient && <Badge text="Viewed by Client" variant="green" />}
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex-shrink-0 p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Close"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-6 flex flex-col gap-6">
          {/* Proposed Terms */}
          <section>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Proposed Terms</h3>
            <dl className="grid grid-cols-2 gap-3">
              <DrawerField label="Proposed Rate" value={proposal.proposedRate} />
              <DrawerField label="Net Rate" value={proposal.receivedRate} />
              <DrawerField label="Rate Increase" value={proposal.rateIncrease} />
              <DrawerField label="Connects Spent" value={proposal.connectsSpent} />
              <DrawerField label="Bid Connects" value={proposal.bidConnects} />
              <DrawerField label="Profile Used" value={proposal.profileUsed} />
              <DrawerField label="Submitted" value={proposal.submittedAt ? fmtDateTime(proposal.submittedAt) : fmtDateTime(proposal.createdAt)} />
            </dl>
          </section>

          {/* Cover Letter */}
          {proposal.coverLetter && (
            <section>
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Cover Letter</h3>
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap bg-gray-50 border border-gray-200 rounded-lg p-4">
                {proposal.coverLetter}
              </p>
            </section>
          )}

          {/* Personal note from client (interviews) */}
          {proposal.clientNote && (
            <section>
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Personal Note from Client</h3>
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap bg-purple-50 border border-purple-100 rounded-lg p-4">
                {proposal.clientNote}
              </p>
            </section>
          )}

          {/* Job Details */}
          <section>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Job Details</h3>
            <dl className="grid grid-cols-2 gap-3">
              <DrawerField label="Category" value={proposal.jobCategory} />
              <DrawerField label="Budget" value={proposal.jobBudget} />
              <DrawerField label="Experience Level" value={proposal.jobExperienceLevel} />
              <DrawerField label="Duration" value={proposal.jobDuration} />
              <DrawerField label="Hours / Week" value={proposal.jobHoursPerWeek} />
              <DrawerField label="Posted" value={proposal.jobPostedDate} />
            </dl>
            {proposal.jobDescription && (
              <div className="mt-3">
                <dt className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Description</dt>
                <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap bg-gray-50 border border-gray-200 rounded-lg p-4 max-h-48 overflow-y-auto">
                  {proposal.jobDescription}
                </p>
              </div>
            )}
          </section>

          {/* Job Skills */}
          {proposal.jobSkills && proposal.jobSkills.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Skills Required</h3>
              <div className="flex flex-wrap gap-1.5">
                {proposal.jobSkills.map((s, i) => (
                  <span key={i} className="px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded-md border border-gray-200">
                    {s}
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* Client Info */}
          <section>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Client Information</h3>
            <dl className="grid grid-cols-2 gap-3">
              {proposal.clientName && (
                <div className="col-span-2">
                  <DrawerField label="Name" value={proposal.clientName} />
                </div>
              )}
              {proposal.clientRating != null && (
                <div className="col-span-2">
                  <dt className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-0.5">Rating</dt>
                  <dd className="flex items-center gap-2 text-sm">
                    <StarRating rating={proposal.clientRating} />
                    <span className="font-medium text-gray-800">{proposal.clientRating}</span>
                    {proposal.clientReviews != null && <span className="text-gray-400">({proposal.clientReviews} reviews)</span>}
                  </dd>
                </div>
              )}
              <DrawerField
                label="Verified"
                value={
                  proposal.clientPaymentVerified
                    ? <Badge text="Payment" variant="green" />
                    : <span className="text-gray-400">—</span>
                }
              />
              <DrawerField label="Location" value={[proposal.clientCity, proposal.clientCountry].filter(Boolean).join(", ") || null} />
              <DrawerField label="Total Spent" value={proposal.clientTotalSpent} />
              <DrawerField label="Total Hires" value={proposal.clientHires} />
              <DrawerField label="Active Hires" value={proposal.clientActiveHires} />
              <DrawerField label="Jobs Posted" value={proposal.clientJobsPosted} />
              <DrawerField label="Open Jobs" value={proposal.clientOpenJobs} />
              <DrawerField label="Hire Rate" value={proposal.clientHireRate != null ? `${proposal.clientHireRate}%` : null} />
              <DrawerField label="Avg Rate" value={proposal.clientAvgRate} />
              <DrawerField label="Total Hours" value={proposal.clientTotalHours} />
              <DrawerField label="Member Since" value={proposal.clientMemberSince} />
            </dl>
          </section>

          {/* Link */}
          {proposal.jobUrl && (
            <a
              href={proposal.jobUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-teal-600 hover:text-teal-700 font-medium"
            >
              Open Job on Upwork
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" />
              </svg>
            </a>
          )}

          {/* Coaching Note */}
          {proposal.capturedBy && (
            <section>
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                Leave a coaching note for {proposal.capturedBy.name}
              </h3>
              {noteSent ? (
                <div className="rounded-lg bg-green-50 border border-green-100 p-3 text-sm text-green-700">
                  Note sent to {proposal.capturedBy.name}.
                  <button
                    onClick={() => setNoteSent(false)}
                    className="ml-2 underline text-green-700 hover:text-green-800"
                  >
                    Send another
                  </button>
                </div>
              ) : (
                <form onSubmit={submitNote} className="space-y-2">
                  <textarea
                    value={noteBody}
                    onChange={(e) => setNoteBody(e.target.value)}
                    required
                    rows={4}
                    placeholder="Write your note. Keep it actionable."
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none"
                  />
                  {noteError && (
                    <div className="rounded-lg bg-rose-50 border border-rose-100 p-2 text-xs text-rose-700">{noteError}</div>
                  )}
                  <button
                    type="submit"
                    disabled={noteSending || noteBody.trim().length === 0}
                    className="px-4 py-2 bg-teal-500 hover:bg-teal-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors shadow-sm"
                  >
                    {noteSending ? "Sending…" : "Send note"}
                  </button>
                </form>
              )}
            </section>
          )}
        </div>
      </div>
    </>
  );
}

// AlertData moved to @/lib/overview-types

// ─── Tab types ────────────────────────────────────────────────────────────────

type Tab =
  | "overview"
  | "jobs"
  | "proposals"
  | "submissions"
  | "alerts"
  | "snapshots"
  | "team"
  | "team-stats"
  | "coverage-pages"
  | "profile-activity"
  | "audit";

// Tooltip style constants were moved to OverviewPanel

// ─── Main Dashboard ──────────────────────────────────────────────────────────

export default function Dashboard() {
  const [accounts, setAccounts] = useState<AccountData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string>("all");

  useEffect(() => {
    if (accounts.length === 0) return;
    const current = accounts.find((a) => a.id === selectedAccountId);
    if (!current) setSelectedAccountId(accounts[0].id);
  }, [accounts, selectedAccountId]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [selectedJob, setSelectedJob] = useState<JobData | null>(null);
  const [selectedProposal, setSelectedProposal] = useState<ProposalData | null>(null);
  const [proposalFilter, setProposalFilter] = useState<string>("all");
  const [overviewRange, setOverviewRange] = useState<OverviewRange>("7d");
  const [alerts, setAlerts] = useState<AlertData[]>([]);
  const [teamMembers, setTeamMembers] = useState<{ id: string; name: string; role: string }[]>([]);
  const [memberFilter, setMemberFilter] = useState<string>("all");
  const [coverageAlert, setCoverageAlert] = useState<{members: {id:string;name:string;pct:number}[]} | null>(null);
  const [coverageAlertDismissed, setCoverageAlertDismissed] = useState(false);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch("/api/accounts").then((r) => r.json()),
      fetch("/api/alerts").then((r) => r.json()).catch(() => []),
      fetch("/api/admin/team")
        .then((r) => (r.ok ? r.json() : { members: [] }))
        .catch(() => ({ members: [] })),
    ])
      .then(([accountData, alertData, teamData]) => {
        if (accountData.error) throw new Error(accountData.error);
        setAccounts(accountData);
        if (Array.isArray(alertData)) setAlerts(alertData);
        const members = Array.isArray(teamData?.members)
          ? teamData.members.map((m: { id: string; name: string; role: string }) => ({ id: m.id, name: m.name, role: m.role }))
          : [];
        setTeamMembers(members);
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));

    fetch("/api/admin/coverage-stats")
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        const low = (data.members || []).filter((m: {role:string;status:string;pct:number}) =>
          m.role === "bidder" && m.status === "active" && m.pct < 60
        );
        if (low.length > 0) setCoverageAlert({ members: low });
      })
      .catch(() => {});
  }, [refreshKey]);

  // Auto-refresh alerts every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      fetch("/api/alerts")
        .then((r) => r.json())
        .then((data) => { if (Array.isArray(data)) setAlerts(data); })
        .catch(() => {});
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const selected = useMemo(() => {
    if (selectedAccountId === "all") return null;
    return accounts.find((a) => a.id === selectedAccountId) || null;
  }, [accounts, selectedAccountId]);

  const overviewAccounts = useMemo(() => {
    const accs = selected ? [selected] : accounts;
    return applyMemberFilter(accs, memberFilter === "all" ? null : memberFilter);
  }, [accounts, selected, memberFilter]);

  const filteredSnapshots = useMemo(
    () => overviewAccounts.flatMap((a) => a.snapshots),
    [overviewAccounts],
  );

  const allJobs = useMemo(() => {
    const accs = selected ? [selected] : accounts;
    const rows = accs.flatMap((a) => a.jobs || []);
    return memberFilter === "all" ? rows : rows.filter((j) => j.capturedBy?.id === memberFilter);
  }, [accounts, selected, memberFilter]);

  const allProposals = useMemo(() => {
    const accs = selected ? [selected] : accounts;
    const rows = accs.flatMap((a) => a.proposals || []);
    return memberFilter === "all" ? rows : rows.filter((p) => p.capturedBy?.id === memberFilter);
  }, [accounts, selected, memberFilter]);

  const submissions = useMemo(
    () => allProposals
      .filter((p) => p.submittedViaExtension)
      .sort((a, b) => {
        const ta = new Date(a.submittedAt || a.createdAt).getTime();
        const tb = new Date(b.submittedAt || b.createdAt).getTime();
        return tb - ta;
      }),
    [allProposals]
  );

  const sortedProposalSections = useMemo(() => {
    const sections = new Map<string, ProposalData[]>();
    for (const p of allProposals) {
      const sec = p.section || "Other";
      if (!sections.has(sec)) sections.set(sec, []);
      sections.get(sec)!.push(p);
    }
    // Sort each section by submittedAt desc (newest first), matching Upwork's list order.
    for (const [, props] of sections) {
      props.sort((a, b) => {
        const ta = new Date(a.submittedAt || a.createdAt).getTime();
        const tb = new Date(b.submittedAt || b.createdAt).getTime();
        return tb - ta;
      });
    }
    const order = ["Offers", "Invites from clients", "Active proposals", "Submitted proposals", "Archived proposals", "Archived interviews", "Other", "Unknown"];
    return Array.from(sections.entries()).sort(
      (a, b) => order.indexOf(a[0]) - order.indexOf(b[0])
    );
  }, [allProposals]);

  const filteredProposalSections = useMemo(
    () => proposalFilter === "all"
      ? sortedProposalSections
      : sortedProposalSections.filter(([section]) => section === proposalFilter),
    [sortedProposalSections, proposalFilter]
  );
  const filteredProposalCount = useMemo(
    () => filteredProposalSections.reduce((sum, [, props]) => sum + props.length, 0),
    [filteredProposalSections]
  );

  const scopedAlerts = useMemo(
    () => {
      const base = selected ? alerts.filter((a) => a.accountId === selected.id) : alerts;
      return memberFilter === "all" ? base : base.filter((a) => a.capturedBy?.id === memberFilter);
    },
    [alerts, selected, memberFilter]
  );

  const unreadAlerts = useMemo(() => scopedAlerts.filter((a) => !a.read && !a.freelancerReplied && a.needsAttention), [scopedAlerts]);
  const alertsByType = useMemo(() => {
    const groups: Record<string, AlertData[]> = { message: [], invite: [], offer: [] };
    for (const a of scopedAlerts) {
      if (!groups[a.type]) groups[a.type] = [];
      groups[a.type].push(a);
    }
    return groups;
  }, [scopedAlerts]);

  const alertCounts = useMemo(() => ({
    messages: alertsByType.message?.filter((a) => !a.read).length || 0,
  }), [alertsByType]);

  const signOutAdmin = useCallback(async () => {
    await fetch("/api/admin/logout", { method: "POST" });
    window.location.href = "/admin/login";
  }, []);

  const dismissAlert = useCallback((id: string) => {
    fetch("/api/alerts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, read: true }),
    }).then(() => {
      setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, read: true } : a)));
    }).catch(() => {});
  }, []);

  const closeDrawer = useCallback(() => {
    setSelectedJob(null);
    setSelectedProposal(null);
  }, []);

  // ── Loading / error / empty states ──────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-6xl mx-auto space-y-4">
          <div className="h-8 w-48 rounded bg-gray-200 animate-pulse" />
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-white border border-gray-200 rounded-xl p-5 h-24 animate-pulse" />
            ))}
          </div>
          <div className="bg-white border border-gray-200 rounded-xl h-64 animate-pulse" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center flex-col gap-4">
        <div className="w-12 h-12 rounded-full bg-rose-50 border border-rose-100 flex items-center justify-center text-rose-500">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        </div>
        <div className="text-gray-900 text-base font-medium">Failed to load dashboard</div>
        <div className="text-xs text-gray-500 max-w-md text-center">{error}</div>
        <button
          onClick={() => setRefreshKey((k) => k + 1)}
          className="px-4 py-2 bg-white border border-gray-200 text-gray-700 text-sm rounded-lg hover:bg-gray-50 transition-colors shadow-sm"
        >
          Retry
        </button>
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center flex-col gap-4 px-6 text-center">
        <div className="w-14 h-14 bg-teal-50 rounded-2xl flex items-center justify-center text-teal-500 border border-teal-100">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7"><path d="M3 3v18h18"/><path d="M7 15l4-8 4 6 4-10"/></svg>
        </div>
        <h1 className="text-xl font-semibold text-gray-900">No data yet</h1>
        <p className="text-gray-500 max-w-md text-sm leading-relaxed">
          Install the Chrome extension, visit your Upwork My Stats page, and your proposal metrics will appear here automatically.
        </p>
      </div>
    );
  }

  const lastSync = accounts
    .filter((a) => a.latestSnapshot)
    .sort((a, b) => new Date(b.latestSnapshot!.capturedAt).getTime() - new Date(a.latestSnapshot!.capturedAt).getTime())[0];

  const TABS: { id: Tab; label: string; count?: number; icon: React.ReactNode }[] = [
    { id: "overview", label: "Overview", icon: <IconHome /> },
    { id: "jobs", label: "Jobs", count: allJobs.length, icon: <IconBriefcase /> },
    { id: "proposals", label: "Proposals", count: allProposals.length, icon: <IconFile /> },
    { id: "submissions", label: "Submissions", count: submissions.length, icon: <IconSend /> },
    { id: "alerts", label: "Alerts", count: unreadAlerts.length, icon: <IconBell /> },
    { id: "snapshots", label: "Snapshots", count: filteredSnapshots.length, icon: <IconCamera /> },
  ];

  // ── Proposal section badge helper ──────────────────────────────────────────

  function sectionBadgeVariant(section: string): "teal" | "purple" | "green" | "blue" | "gray" {
    if (section.toLowerCase().includes("offer")) return "teal";
    if (section.toLowerCase().includes("invite")) return "purple";
    if (section.toLowerCase().includes("active")) return "green";
    if (section.toLowerCase().includes("submitted")) return "blue";
    return "gray";
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const ADMIN_TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "team", label: "Team", icon: <IconUsers /> },
    { id: "team-stats", label: "Team Stats", icon: <IconChart /> },
    { id: "coverage-pages", label: "Coverage Pages", icon: <IconCompass /> },
    { id: "profile-activity", label: "Profile Activity", icon: <IconCamera /> },
    { id: "audit", label: "Audit Log", icon: <IconShield /> },
  ];

  const activeTabLabel =
    TABS.find((t) => t.id === activeTab)?.label ??
    ADMIN_TABS.find((t) => t.id === activeTab)?.label ??
    "Overview";

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 flex">
      {/* Drawers */}
      {selectedJob && <JobDrawer job={selectedJob} onClose={closeDrawer} />}
      {selectedProposal && <ProposalDrawer proposal={selectedProposal} onClose={closeDrawer} />}

      {/* Coverage alert modal */}
      {coverageAlert && !coverageAlertDismissed && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setCoverageAlertDismissed(true)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-rose-50 border border-rose-100 flex items-center justify-center text-rose-500 shrink-0">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/>
                  <line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
              </div>
              <div>
                <h3 className="text-base font-semibold text-gray-900">Low coverage alert</h3>
                <p className="text-sm text-gray-500 mt-0.5">The following bidders have opened fewer than 60% of required pages.</p>
              </div>
            </div>
            <ul className="space-y-2 mb-5">
              {coverageAlert.members.map(m => (
                <li key={m.id} className="flex items-center justify-between px-3 py-2 bg-rose-50 border border-rose-100 rounded-lg">
                  <span className="text-sm font-medium text-gray-900">{m.name}</span>
                  <span className="text-sm font-bold text-rose-600">{m.pct}%</span>
                </li>
              ))}
            </ul>
            <button
              onClick={() => setCoverageAlertDismissed(true)}
              className="w-full px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <aside className="w-60 bg-white border-r border-gray-200 flex flex-col sticky top-0 h-screen flex-shrink-0">
        <div className="h-14 px-5 flex items-center border-b border-gray-200">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-teal-500 text-white flex items-center justify-center text-xs font-bold">UT</div>
            <span className="text-sm font-semibold text-gray-900 tracking-tight">Upwork Tracker</span>
          </div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
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
                  <span className={`text-[11px] px-1.5 py-0.5 rounded-full font-medium ${
                    isActive ? "bg-teal-100 text-teal-700" : "bg-gray-100 text-gray-500"
                  }`}>
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
        <div className="px-3 py-3 border-t border-gray-200">
          <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold px-3 mb-2">Admin</div>
          <nav className="space-y-1">
            {ADMIN_TABS.map((tab) => {
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
                </button>
              );
            })}
            <button
              onClick={signOutAdmin}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors text-rose-600 hover:bg-rose-50"
            >
              <span className="text-rose-400"><IconSignOut /></span>
              <span className="flex-1 text-left">Sign out</span>
            </button>
          </nav>
        </div>
        <div className="p-3 border-t border-gray-200 space-y-3">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold px-1">Account</label>
            <select
              value={selectedAccountId}
              onChange={(e) => setSelectedAccountId(e.target.value)}
              className="w-full mt-1.5 text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-teal-500 cursor-pointer"
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
          {teamMembers.length > 0 && (
            <div>
              <label className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold px-1">Captured by</label>
              <select
                value={memberFilter}
                onChange={(e) => setMemberFilter(e.target.value)}
                className="w-full mt-1.5 text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-teal-500 cursor-pointer"
              >
                <option value="all">All team members</option>
                {teamMembers.map((m) => (
                  <option key={m.id} value={m.id}>{m.name} ({m.role == 'admin' ? 'Admin' : 'Bidder'})</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </aside>

      {/* ── Main ────────────────────────────────────────────────────────── */}
      <main className="flex-1 min-w-0 flex flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-10 bg-white/80 backdrop-blur border-b border-gray-200 h-14 flex items-center justify-between px-6">
          <div>
            <h1 className="text-sm font-semibold text-gray-900">{activeTabLabel}</h1>
            {lastSync?.latestSnapshot && (
              <p className="text-[11px] text-gray-400">
                Last sync {fmtDateTime(lastSync.latestSnapshot.capturedAt)}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setRefreshKey((k) => k + 1)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 shadow-sm transition-colors"
            >
              <IconRefresh /> Refresh
            </button>
          </div>
        </header>

        <div className="flex-1 px-6 pb-6 overflow-auto">

        {/* ── Overview Tab ─────────────────────────────────────────────────── */}
        {activeTab === "overview" && (
          <OverviewPanel
            accounts={overviewAccounts}
            range={overviewRange}
            onRangeChange={setOverviewRange}
            showAccountComparison={!selected}
          />
        )}

        {/* ── Jobs Tab ─────────────────────────────────────────────────────── */}
        {activeTab === "jobs" && (
          <div className="py-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
                Jobs Viewed
                <span className="ml-2 text-gray-400 font-normal normal-case tracking-normal">({allJobs.length})</span>
              </h2>
              <span className="text-xs text-gray-400">Click a row to see full details</span>
            </div>

            {allJobs.length === 0 ? (
              <div className="border border-gray-200 rounded-xl py-16 text-center text-gray-400 text-sm">
                No jobs tracked yet
              </div>
            ) : (
              <div className="border border-gray-200 rounded-xl overflow-x-auto shadow-sm">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50">
                      <th className="text-left px-4 py-3 text-gray-500 font-medium text-xs uppercase tracking-wide">Job Title</th>
                      <th className="text-left px-4 py-3 text-gray-500 font-medium text-xs uppercase tracking-wide">Type / Budget</th>
                      <th className="text-left px-4 py-3 text-gray-500 font-medium text-xs uppercase tracking-wide">Level</th>
                      <th className="text-right px-4 py-3 text-gray-500 font-medium text-xs uppercase tracking-wide">Connects</th>
                      <th className="text-left px-4 py-3 text-gray-500 font-medium text-xs uppercase tracking-wide">Client</th>
                      <th className="text-left px-4 py-3 text-gray-500 font-medium text-xs uppercase tracking-wide">Skills</th>
                      <th className="text-left px-4 py-3 text-gray-500 font-medium text-xs uppercase tracking-wide">By</th>
                      <th className="text-left px-4 py-3 text-gray-500 font-medium text-xs uppercase tracking-wide">Viewed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allJobs.map((j) => (
                      <tr
                        key={j.id}
                        onClick={() => setSelectedJob(j)}
                        className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors"
                      >
                        <td className="px-4 py-3 max-w-xs">
                          <span className="text-teal-600 font-medium truncate block">{j.title}</span>
                          {j.category && <span className="text-xs text-gray-400">{j.category}</span>}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-0.5">
                            <span className="text-gray-600 capitalize text-xs">{j.jobType || "—"}</span>
                            {j.budget && <span className="text-amber-600 font-medium text-xs">{j.budget}</span>}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-600 capitalize text-xs">{j.experienceLevel || "—"}</td>
                        <td className="px-4 py-3 text-right">
                          {j.connectsRequired != null
                            ? <span className="text-orange-500 font-medium text-xs">{j.connectsRequired}</span>
                            : <span className="text-gray-300">—</span>
                          }
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-0.5 text-xs max-w-[220px]">
                            {j.clientRating != null && (
                              <div className="flex items-center gap-1">
                                <StarRating rating={j.clientRating} />
                                <span className="text-gray-700 font-medium">{j.clientRating}</span>
                              </div>
                            )}
                            <div className="flex items-center gap-1 flex-wrap">
                              {j.clientPaymentVerified && (
                                <span className="px-1 py-0.5 bg-green-50 text-green-600 border border-green-100 rounded text-[10px]">Pay</span>
                              )}
                              {j.clientPhoneVerified && (
                                <span className="px-1 py-0.5 bg-green-50 text-green-600 border border-green-100 rounded text-[10px]">Phone</span>
                              )}
                            </div>
                            {(j.clientCountry || j.clientCity) && (
                              <span className="text-gray-500">{[j.clientCity, j.clientCountry].filter(Boolean).join(", ")}</span>
                            )}
                            {j.clientSpent && <span className="text-green-600 font-medium">{j.clientSpent} spent</span>}
                            {j.clientHireRate != null && (
                              <span className="text-teal-600">{j.clientHireRate}% hire rate</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1 max-w-[200px]">
                            {(j.skills || []).slice(0, 3).map((s, i) => (
                              <span key={i} className="px-1.5 py-0.5 text-[10px] bg-gray-100 text-gray-600 border border-gray-200 rounded">
                                {s}
                              </span>
                            ))}
                            {(j.skills || []).length > 3 && (
                              <span className="text-[10px] text-gray-400">+{j.skills.length - 3}</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{j.capturedBy?.name || "—"}</td>
                        <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{fmtDateTime(j.viewedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── Proposals Tab ────────────────────────────────────────────────── */}
        {activeTab === "proposals" && (
          <div className="py-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
                Proposals
                <span className="ml-2 text-gray-400 font-normal normal-case tracking-normal">
                  ({filteredProposalCount}{proposalFilter !== "all" ? ` of ${allProposals.length}` : ""})
                </span>
              </h2>
              <div className="flex items-center gap-3">
                <select
                  value={proposalFilter}
                  onChange={(e) => setProposalFilter(e.target.value)}
                  className="text-xs border border-gray-200 rounded-md px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-teal-500 cursor-pointer"
                >
                  <option value="all">All sections</option>
                  {sortedProposalSections.map(([section, props]) => (
                    <option key={section} value={section}>
                      {section} ({props.length})
                    </option>
                  ))}
                </select>
                <span className="text-xs text-gray-400 hidden sm:inline">Click a row to see full details</span>
              </div>
            </div>

            {allProposals.length === 0 ? (
              <div className="border border-gray-200 rounded-xl py-16 text-center text-gray-400 text-sm">
                No proposals tracked yet
              </div>
            ) : filteredProposalSections.length === 0 ? (
              <div className="border border-gray-200 rounded-xl py-16 text-center text-gray-400 text-sm">
                No proposals in this section
              </div>
            ) : (
              <div className="flex flex-col gap-6">
                {filteredProposalSections.map(([section, props]) => {
                  const isArchived = section.toLowerCase().includes("archived");
                  const isInterview = section.toLowerCase().includes("interview");
                  const unit = isInterview ? "interview" : "proposal";
                  return (
                  <div key={section}>
                    <div className="flex items-center gap-3 mb-3">
                      <Badge text={section} variant={sectionBadgeVariant(section)} />
                      <span className="text-xs text-gray-400">{props.length} {unit}{props.length !== 1 ? "s" : ""}</span>
                    </div>
                    <div className="border border-gray-200 rounded-xl overflow-x-auto shadow-sm">
                      {isArchived ? (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-200 bg-gray-50">
                            <th className="text-left px-4 py-3 text-gray-500 font-medium text-xs uppercase tracking-wide">{isInterview ? "Received" : "Initiated"}</th>
                            <th className="text-left px-4 py-3 text-gray-500 font-medium text-xs uppercase tracking-wide">Job Title</th>
                            <th className="text-left px-4 py-3 text-gray-500 font-medium text-xs uppercase tracking-wide">Status</th>
                            <th className="text-left px-4 py-3 text-gray-500 font-medium text-xs uppercase tracking-wide">Profile</th>
                            <th className="text-left px-4 py-3 text-gray-500 font-medium text-xs uppercase tracking-wide">By</th>
                          </tr>
                        </thead>
                        <tbody>
                          {props.map((p) => (
                            <tr
                              key={p.id}
                              onClick={() => setSelectedProposal(p)}
                              className="border-b border-gray-100 last:border-0 hover:bg-gray-50 cursor-pointer transition-colors"
                            >
                              <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                                {p.submittedAt ? fmtDateTime(p.submittedAt) : fmtDateTime(p.createdAt)}
                              </td>
                              <td className="px-4 py-3 max-w-md">
                                <span className="text-teal-600 font-medium truncate block">{p.jobTitle || "Untitled"}</span>
                              </td>
                              <td className="px-4 py-3">
                                {p.status
                                  ? <Badge text={p.status} variant="gray" />
                                  : <span className="text-gray-300 text-xs">—</span>
                                }
                              </td>
                              <td className="px-4 py-3 text-gray-500 text-xs">{p.profileUsed || "—"}</td>
                              <td className="px-4 py-3 text-gray-500 text-xs">{p.capturedBy?.name || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      ) : (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-200 bg-gray-50">
                            <th className="text-left px-4 py-3 text-gray-500 font-medium text-xs uppercase tracking-wide">Job Title</th>
                            <th className="text-left px-4 py-3 text-gray-500 font-medium text-xs uppercase tracking-wide">Boost</th>
                            <th className="text-center px-4 py-3 text-gray-500 font-medium text-xs uppercase tracking-wide">Viewed</th>
                            <th className="text-right px-4 py-3 text-gray-500 font-medium text-xs uppercase tracking-wide">Rate</th>
                            <th className="text-left px-4 py-3 text-gray-500 font-medium text-xs uppercase tracking-wide">Client</th>
                            <th className="text-left px-4 py-3 text-gray-500 font-medium text-xs uppercase tracking-wide">Profile</th>
                            <th className="text-left px-4 py-3 text-gray-500 font-medium text-xs uppercase tracking-wide">By</th>
                            <th className="text-left px-4 py-3 text-gray-500 font-medium text-xs uppercase tracking-wide">Submitted</th>
                          </tr>
                        </thead>
                        <tbody>
                          {props.map((p) => (
                            <tr
                              key={p.id}
                              onClick={() => setSelectedProposal(p)}
                              className="border-b border-gray-100 last:border-0 hover:bg-gray-50 cursor-pointer transition-colors align-top"
                            >
                              <td className="px-4 py-3 max-w-sm">
                                <div className="flex flex-col gap-1">
                                  <span className="text-teal-600 font-medium truncate block">{p.jobTitle || "Untitled"}</span>
                                  <div className="flex flex-wrap gap-1">
                                    {p.jobCategory && (
                                      <span className="px-1.5 py-0.5 text-[10px] bg-purple-50 text-purple-600 border border-purple-100 rounded">
                                        {p.jobCategory}
                                      </span>
                                    )}
                                    {p.jobExperienceLevel && (
                                      <span className="px-1.5 py-0.5 text-[10px] bg-blue-50 text-blue-600 border border-blue-100 rounded capitalize">
                                        {p.jobExperienceLevel}
                                      </span>
                                    )}
                                    {p.jobBudget && (
                                      <span className="text-[10px] text-amber-600 font-medium">{p.jobBudget}</span>
                                    )}
                                  </div>
                                  {p.coverLetter && (
                                    <span className="text-gray-400 text-[11px] truncate block max-w-sm">
                                      {p.coverLetter.slice(0, 90)}...
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                {p.boosted ? (
                                  <div className="flex flex-col gap-0.5">
                                    <Badge
                                      text={p.boostStatus || "Boosted"}
                                      variant={p.boostStatus === "Boost outbid" ? "rose" : "amber"}
                                    />
                                    {p.bidConnects != null && (
                                      <span className="text-[10px] text-orange-500">{p.bidConnects} connects</span>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-gray-300 text-xs">—</span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-center">
                                {p.viewedByClient
                                  ? <Badge text="Viewed" variant="green" />
                                  : <span className="text-gray-300 text-xs">—</span>
                                }
                              </td>
                              <td className="px-4 py-3 text-right">
                                {p.proposedRate ? (
                                  <div className="flex flex-col gap-0.5 items-end">
                                    <span className="text-amber-600 font-medium text-xs">{p.proposedRate}</span>
                                    {p.receivedRate && <span className="text-[10px] text-gray-400">net {p.receivedRate}</span>}
                                  </div>
                                ) : (
                                  <span className="text-gray-300 text-xs">—</span>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex flex-col gap-0.5 text-xs max-w-[180px]">
                                  {p.clientRating != null && (
                                    <div className="flex items-center gap-1">
                                      <StarRating rating={p.clientRating} />
                                      <span className="text-gray-700 font-medium">{p.clientRating}</span>
                                    </div>
                                  )}
                                  {p.clientPaymentVerified && (
                                    <span className="px-1 py-0.5 bg-green-50 text-green-600 border border-green-100 rounded text-[10px] w-fit">
                                      Pay Verified
                                    </span>
                                  )}
                                  {(p.clientCountry || p.clientCity) && (
                                    <span className="text-gray-500">{[p.clientCity, p.clientCountry].filter(Boolean).join(", ")}</span>
                                  )}
                                  {p.clientTotalSpent && (
                                    <span className="text-green-600 font-medium">{p.clientTotalSpent} spent</span>
                                  )}
                                  {p.clientHireRate != null && (
                                    <span className="text-teal-600">{p.clientHireRate}% hire rate</span>
                                  )}
                                  {!p.clientRating && !p.clientTotalSpent && !p.clientCountry && p.clientName && (
                                    <span className="text-gray-500">{p.clientName}</span>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-3 text-gray-400 text-xs">{p.profileUsed || "—"}</td>
                              <td className="px-4 py-3 text-gray-500 text-xs">{p.capturedBy?.name || "—"}</td>
                              <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">
                                {p.submittedAt ? fmtDateTime(p.submittedAt) : fmtDateTime(p.createdAt)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      )}
                    </div>
                  </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Submissions Tab ─────────────────────────────────────────────── */}
        {activeTab === "submissions" && (
          <div className="py-6">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-base font-semibold text-gray-900">Submissions</h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  Captured the moment you clicked “Submit a Proposal” on Upwork
                </p>
              </div>
              <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-md">
                {submissions.length} total
              </span>
            </div>

            {submissions.length === 0 ? (
              <div className="border border-dashed border-gray-200 rounded-xl py-20 px-6 text-center">
                <div className="mx-auto w-12 h-12 rounded-full bg-teal-50 text-teal-500 border border-teal-100 flex items-center justify-center mb-4">
                  <IconSend />
                </div>
                <h3 className="text-sm font-semibold text-gray-700">No submissions yet</h3>
                <p className="text-xs text-gray-400 mt-1 max-w-md mx-auto">
                  Submissions appear here automatically when you click “Submit a Proposal” on an Upwork apply page with the extension active.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {submissions.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setSelectedProposal(p)}
                    className="text-left w-full bg-white border border-gray-200 rounded-xl p-5 hover:border-teal-300 hover:shadow-sm transition-all"
                  >
                    <div className="flex items-start justify-between gap-4 mb-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-teal-50 text-teal-700 border border-teal-100">
                            <span className="w-1.5 h-1.5 rounded-full bg-teal-500 animate-pulse" />
                            LIVE
                          </span>
                          <span className="text-[11px] text-gray-400">
                            {fmtDateTime(p.submittedAt || p.createdAt)}
                          </span>
                        </div>
                        <h3 className="text-sm font-semibold text-gray-900 truncate">
                          {p.jobTitle || "Untitled"}
                        </h3>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {p.proposedRate && (
                          <span className="text-xs font-medium text-amber-600">{p.proposedRate}</span>
                        )}
                        {p.bidConnects != null && (
                          <span className="text-[11px] text-orange-500">{p.bidConnects} connects</span>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 mb-3 text-[11px]">
                      {p.profileUsed && (
                        <span className="px-2 py-0.5 rounded bg-gray-50 border border-gray-200 text-gray-600">
                          {p.profileUsed}
                        </span>
                      )}
                      {p.jobCategory && (
                        <span className="px-2 py-0.5 rounded bg-purple-50 border border-purple-100 text-purple-700">
                          {p.jobCategory}
                        </span>
                      )}
                      {p.jobBudget && (
                        <span className="px-2 py-0.5 rounded bg-amber-50 border border-amber-100 text-amber-700">
                          {p.jobBudget}
                        </span>
                      )}
                      {p.jobExperienceLevel && (
                        <span className="px-2 py-0.5 rounded bg-blue-50 border border-blue-100 text-blue-700 capitalize">
                          {p.jobExperienceLevel}
                        </span>
                      )}
                      {p.jobDuration && (
                        <span className="px-2 py-0.5 rounded bg-gray-50 border border-gray-200 text-gray-600">
                          {p.jobDuration}
                        </span>
                      )}
                    </div>

                    {(p.clientRating != null || p.clientTotalSpent || p.clientHireRate != null || p.clientCountry) && (
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500 mb-3 pb-3 border-b border-gray-100">
                        {p.clientRating != null && (
                          <span className="flex items-center gap-1">
                            <StarRating rating={p.clientRating} />
                            <span className="text-gray-700 font-medium">{p.clientRating}</span>
                            {p.clientReviews != null && <span>({p.clientReviews})</span>}
                          </span>
                        )}
                        {p.clientPaymentVerified && (
                          <span className="text-green-600">Pay verified</span>
                        )}
                        {p.clientTotalSpent && (
                          <span className="text-green-600 font-medium">{p.clientTotalSpent} spent</span>
                        )}
                        {p.clientHireRate != null && (
                          <span className="text-teal-600">{p.clientHireRate}% hire rate</span>
                        )}
                        {(p.clientCity || p.clientCountry) && (
                          <span>{[p.clientCity, p.clientCountry].filter(Boolean).join(", ")}</span>
                        )}
                      </div>
                    )}

                    {p.coverLetter && (
                      <p className="text-xs text-gray-600 leading-relaxed line-clamp-3 whitespace-pre-wrap">
                        {p.coverLetter}
                      </p>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Alerts Tab ──────────────────────────────────────────────────── */}
        {activeTab === "alerts" && (
          <div className="py-6">
            {/* Alert stats */}
            <div className="grid grid-cols-2 gap-3 mb-6">
              <StatCard label="Unread Messages" value={alertCounts.messages} color={COLORS.blue} />
              <StatCard label="Total Messages (7d)" value={scopedAlerts.length} color={COLORS.teal} />
            </div>

            {scopedAlerts.length === 0 ? (
              <div className="border border-gray-200 rounded-xl py-16 text-center text-gray-400 text-sm">
                No alerts for this account yet -- browse Upwork with the extension active to start receiving alerts
              </div>
            ) : (
              <div className="flex flex-col gap-6">
                {/* Messages */}
                {alertsByType.message && alertsByType.message.length > 0 && (
                  <div>
                    <div className="flex items-center gap-3 mb-3">
                      <Badge text="Messages" variant="blue" />
                      <span className="text-xs text-gray-400">{alertsByType.message.length} alert{alertsByType.message.length !== 1 ? "s" : ""}</span>
                    </div>
                    <div className="flex flex-col gap-2">
                      {alertsByType.message.map((a) => {
                        const isUnreplied = !a.freelancerReplied && !a.replied;
                        return (
                          <div
                            key={a.id}
                            className={`border rounded-xl p-4 flex items-start gap-4 transition-colors ${
                              a.read ? "bg-gray-50 border-gray-200 opacity-60" :
                              isUnreplied ? "bg-white border-rose-200 shadow-sm" :
                              "bg-white border-blue-200 shadow-sm"
                            }`}
                          >
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${
                              isUnreplied ? "bg-rose-50 border border-rose-200 text-rose-600" : "bg-blue-50 border border-blue-200 text-blue-600"
                            }`}>
                              {a.senderName?.[0]?.toUpperCase() || "M"}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                {a.senderName && <span className="font-semibold text-sm text-gray-900">{a.senderName}</span>}
                                {a.date && <span className="text-xs text-gray-400">{a.date}</span>}
                                {isUnreplied && <Badge text="Unreplied" variant="rose" />}
                                {a.freelancerReplied && <Badge text="Replied" variant="green" />}
                                {a.isUnread && <Badge text="Unread" variant="amber" />}
                              </div>
                              {a.jobTitle && <p className="text-xs text-gray-400 mt-0.5">{a.jobTitle}</p>}
                              <p className="text-sm text-gray-600 mt-0.5 truncate">{a.preview || a.title}</p>
                              {a.lastMessageSender && a.lastMessageText && (
                                <p className="text-xs text-gray-500 mt-1 truncate">
                                  Last: <span className="font-medium">{a.lastMessageSender}</span> ({a.lastMessageTime}): {a.lastMessageText}
                                </p>
                              )}
                              <p className="text-xs text-gray-400 mt-1">
                                {a.accountName} — {fmtDateTime(a.createdAt)}
                                {a.capturedBy && <span className="ml-1 font-medium text-gray-500">· {a.capturedBy.name}</span>}
                              </p>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              {/* {a.url && (
                                <a href={a.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline">
                                  Open
                                </a>
                              )} */}
                              {!a.read && (
                                <button
                                  onClick={() => dismissAlert(a.id)}
                                  className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1 border border-gray-200 rounded-md hover:bg-gray-50"
                                >
                                  Dismiss
                                </button>
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
          </div>
        )}

        {/* ── Snapshots Tab ────────────────────────────────────────────────── */}
        {activeTab === "snapshots" && (
          <div className="py-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
                Snapshot History
                <span className="ml-2 text-gray-400 font-normal normal-case tracking-normal">({filteredSnapshots.length})</span>
              </h2>
            </div>

            {filteredSnapshots.length === 0 ? (
              <div className="border border-gray-200 rounded-xl py-16 text-center text-gray-400 text-sm">
                No snapshots recorded yet
              </div>
            ) : (
              <div className="border border-gray-200 rounded-xl overflow-x-auto shadow-sm">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50">
                      {!selected && (
                        <th className="text-left px-4 py-3 text-gray-500 font-medium text-xs uppercase tracking-wide">Account</th>
                      )}
                      <th className="text-left px-4 py-3 text-gray-500 font-medium text-xs uppercase tracking-wide">Date</th>
                      <th className="text-right px-4 py-3 text-gray-500 font-medium text-xs uppercase tracking-wide">Sent</th>
                      <th className="text-right px-4 py-3 text-gray-500 font-medium text-xs uppercase tracking-wide">Viewed</th>
                      <th className="text-right px-4 py-3 text-gray-500 font-medium text-xs uppercase tracking-wide">Interviewed</th>
                      <th className="text-right px-4 py-3 text-gray-500 font-medium text-xs uppercase tracking-wide">Hired</th>
                      <th className="text-right px-4 py-3 text-gray-500 font-medium text-xs uppercase tracking-wide">View %</th>
                      <th className="text-right px-4 py-3 text-gray-500 font-medium text-xs uppercase tracking-wide">Hire %</th>
                      <th className="text-right px-4 py-3 text-gray-500 font-medium text-xs uppercase tracking-wide">Boosted</th>
                      <th className="text-right px-4 py-3 text-gray-500 font-medium text-xs uppercase tracking-wide">Organic</th>
                      {filteredSnapshots.some((s) => s.jss !== null) && (
                        <th className="text-right px-4 py-3 text-gray-500 font-medium text-xs uppercase tracking-wide">JSS</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {(selected ? [selected] : accounts).flatMap((acc) =>
                      acc.snapshots.slice().reverse().slice(0, 100).map((s) => (
                        <tr key={s.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                          {!selected && (
                            <td className="px-4 py-2.5 text-gray-700 text-xs">{acc.name}</td>
                          )}
                          <td className="px-4 py-2.5 text-gray-600 text-xs whitespace-nowrap">{fmtDateTime(s.capturedAt)}</td>
                          <td className="px-4 py-2.5 text-right font-medium" style={{ color: COLORS.blue }}>{s.sent}</td>
                          <td className="px-4 py-2.5 text-right" style={{ color: COLORS.cyan }}>{s.viewed}</td>
                          <td className="px-4 py-2.5 text-right" style={{ color: COLORS.purple }}>{s.interviewed}</td>
                          <td className="px-4 py-2.5 text-right font-medium" style={{ color: COLORS.green }}>{s.hired}</td>
                          <td className="px-4 py-2.5 text-right text-gray-500 text-xs">{s.viewRate}%</td>
                          <td className="px-4 py-2.5 text-right text-gray-500 text-xs">{s.hireRate}%</td>
                          <td className="px-4 py-2.5 text-right" style={{ color: COLORS.amber }}>{s.boostedSent}</td>
                          <td className="px-4 py-2.5 text-right" style={{ color: COLORS.teal }}>{s.organicSent}</td>
                          {filteredSnapshots.some((snap) => snap.jss !== null) && (
                            <td className="px-4 py-2.5 text-right text-gray-600 text-xs">
                              {s.jss !== null ? `${s.jss}%` : "—"}
                            </td>
                          )}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

          {/* ── Team Tab ─────────────────────────────────────────────────────── */}
          {activeTab === "team" && <TeamView />}

          {/* ── Team Stats Tab ───────────────────────────────────────────────── */}
          {activeTab === "team-stats" && <TeamStatsView />}

          {/* ── Coverage Pages Tab ───────────────────────────────────────────── */}
          {activeTab === "coverage-pages" && <CoveragePagesView />}

          {/* ── Profile Activity Tab ─────────────────────────────────────────── */}
          {activeTab === "profile-activity" && (
            <ProfileActivityView
              accountId={(selected ?? accounts[0])?.id ?? ""}
              accountName={(selected ?? accounts[0])?.name ?? ""}
            />
          )}

          {/* ── Audit Tab ────────────────────────────────────────────────────── */}
          {activeTab === "audit" && <AuditView />}

          {/* ── Footer ───────────────────────────────────────────────────────── */}
          <div className="text-center text-xs text-gray-400 border-t border-gray-100 mt-4 py-4">
            Upwork Tracker — {accounts.length} account{accounts.length !== 1 ? "s" : ""} — {filteredSnapshots.length} snapshots
            {(() => {
              const j = accounts.reduce((s, a) => s + (a.jobCount || 0), 0);
              return j > 0 ? ` — ${j} jobs tracked` : "";
            })()}
          </div>
        </div>
      </main>
    </div>
  );
}
