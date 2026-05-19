"use client";

import { useState } from "react";

const iconProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

type SectionId = "setup" | "popup" | "syncing" | "verdicts" | "proposals" | "nudges" | "coverage" | "notes" | "tips";

const SECTIONS: { id: SectionId; label: string; icon: React.ReactNode }[] = [
  {
    id: "setup",
    label: "Setup",
    icon: <svg {...iconProps} className="w-3.5 h-3.5"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>,
  },
  {
    id: "popup",
    label: "Popup",
    icon: <svg {...iconProps} className="w-3.5 h-3.5"><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="9" y1="9" x2="15" y2="9" /><line x1="9" y1="13" x2="15" y2="13" /><line x1="9" y1="17" x2="12" y2="17" /></svg>,
  },
  {
    id: "syncing",
    label: "Syncing",
    icon: <svg {...iconProps} className="w-3.5 h-3.5"><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>,
  },
  {
    id: "verdicts",
    label: "Suggestions",
    icon: <svg {...iconProps} className="w-3.5 h-3.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>,
  },
  {
    id: "proposals",
    label: "Proposals",
    icon: <svg {...iconProps} className="w-3.5 h-3.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>,
  },
  {
    id: "nudges",
    label: "Nudges",
    icon: <svg {...iconProps} className="w-3.5 h-3.5"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>,
  },
  {
    id: "coverage",
    label: "Coverage",
    icon: <svg {...iconProps} className="w-3.5 h-3.5"><circle cx="12" cy="12" r="10" /><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" /></svg>,
  },
  {
    id: "notes",
    label: "Coaching",
    icon: <svg {...iconProps} className="w-3.5 h-3.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>,
  },
  {
    id: "tips",
    label: "Tips",
    icon: <svg {...iconProps} className="w-3.5 h-3.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>,
  },
];

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 items-start">
      <div className="shrink-0 w-5 h-5 rounded-full bg-teal-500 text-white text-[10px] font-bold flex items-center justify-center mt-0.5">
        {n}
      </div>
      <p className="text-sm text-gray-600 leading-relaxed">{children}</p>
    </div>
  );
}

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 shrink-0 text-amber-500 mt-0.5">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      <p className="text-xs text-amber-800 leading-relaxed">{children}</p>
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2.5">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 shrink-0 text-blue-500 mt-0.5">
        <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <p className="text-xs text-blue-800 leading-relaxed">{children}</p>
    </div>
  );
}

function PopupMock() {
  return (
    <div className="w-full lg:w-64 rounded-2xl bg-[#1a1a1a] text-white p-4 shadow-xl text-sm font-sans lg:shrink-0">
      <p className="text-sm font-bold mb-3">Upwork Tracker</p>
      <div className="bg-[#2a2a2a] rounded-xl p-3 mb-3">
        <p className="font-semibold text-white text-xs">Your Name</p>
        <p className="text-gray-400 text-[11px] mt-0.5">you@email.com</p>
        <p className="text-gray-500 text-[11px] mt-1.5 underline cursor-pointer">Change token</p>
      </div>
      {[
        { label: "Account", value: "01165db1c2ab…", cls: "text-gray-300" },
        { label: "Last Sync", value: "Just now", cls: "text-green-400" },
        { label: "Total Syncs", value: "96", cls: "text-gray-300" },
        { label: "Queued", value: "0", cls: "text-gray-300" },
        { label: "Status", value: "Active", cls: "text-green-400 font-semibold" },
      ].map((row, i, arr) => (
        <div key={row.label} className={`flex items-center justify-between py-1.5 ${i < arr.length - 1 ? "border-b border-white/10" : ""}`}>
          <span className="text-gray-400 text-xs">{row.label}</span>
          <span className={`text-xs ${row.cls}`}>{row.value}</span>
        </div>
      ))}
      <button className="mt-3 w-full bg-green-500 text-white font-bold py-2 rounded-xl text-xs">Force Sync</button>
    </div>
  );
}

function NudgeMock() {
  return (
    <div className="w-full lg:w-64 rounded-2xl bg-white border border-orange-200 p-4 shadow-lg lg:shrink-0">
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-base">📌</span>
        <p className="text-sm font-bold text-gray-900">Scan reminder</p>
      </div>
      <p className="text-[11px] font-bold text-orange-500 uppercase tracking-wide mb-2">
        13 Unscanned Proposals
      </p>
      <p className="text-xs text-gray-700 leading-relaxed mb-4">
        Open each one once so the tracker captures the cover letter and job details.
      </p>
      <div className="flex gap-2">
        <button className="flex-1 bg-orange-500 hover:bg-orange-400 text-white font-bold py-2 rounded-xl text-xs transition-colors">
          Open Proposals
        </button>
        <button className="px-3 bg-white border border-gray-200 text-gray-600 font-semibold py-2 rounded-xl text-xs">
          Dismiss
        </button>
      </div>
    </div>
  );
}

// ── Section content components ──────────────────────────────────────────────

function SectionSetup() {
  return (
    <div className="space-y-5">
      <p className="text-sm text-gray-500">The extension runs silently in Chrome while you use Upwork — it captures and syncs your data to this dashboard automatically.</p>
      <div className="space-y-3">
        <Step n={1}>
          <span><strong>Install the extension</strong> — your admin will provide the Chrome extension file. Open <span className="font-mono text-xs bg-gray-100 px-1 py-0.5 rounded">chrome://extensions</span>, enable <em>Developer mode</em> (top-right toggle), then drag and drop the file onto the page.</span>
        </Step>
        <Step n={2}>
          <span><strong>Get your token from your admin</strong> — your admin generates a personal extension token for you and shares it directly. Keep it private; it identifies you across all your activity.</span>
        </Step>
        <Step n={3}>
          <span><strong>Add the token to the extension</strong> — click the Upwork Tracker icon in your Chrome toolbar to open the popup. Paste your token in the input field and save. Your name and email appear once it is accepted.</span>
        </Step>
      </div>
      <Tip>If you see a yellow banner at the top of Upwork pages, your token hasn&apos;t been added yet. Click the extension icon and paste the token your admin gave you.</Tip>
    </div>
  );
}

function SectionPopup() {
  const rows = [
    { label: "Your name & email", desc: "Confirms the extension knows who you are. Appears once your token is saved." },
    { label: "Change token", desc: "Use this if your admin gives you a new token or you need to re-authenticate." },
    { label: "Account", desc: "Your Upwork freelancer ID — used to link synced data to your account." },
    { label: "Last Sync", desc: "Timestamp of the last successful sync. If it looks stale, visit a required Upwork page." },
    { label: "Total Syncs", desc: "Running count of sync events completed since install." },
    { label: "Queued", desc: "Payloads waiting to be sent. Usually 0 — if it stays high, check your connection." },
    { label: "Status", desc: "Shows Active in green when everything is working. Re-enter your token if it shows an error." },
  ];
  return (
    <div className="space-y-5">
      <p className="text-sm text-gray-500">Click the Upwork Tracker icon in your Chrome toolbar at any time to check the extension status.</p>
      <div className="flex flex-col lg:flex-row gap-6 items-start">
        <PopupMock />
        <div className="flex-1 divide-y divide-gray-100">
          {rows.map((r) => (
            <div key={r.label} className="flex gap-3 py-2 first:pt-0 last:pb-0">
              <span className="text-xs font-semibold text-gray-800 w-28 shrink-0 mt-0.5">{r.label}</span>
              <span className="text-xs text-gray-500 leading-relaxed">{r.desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SectionSyncing() {
  const cards = [
    { title: "Account Stats", desc: "JSS, connects balance, and conversion rates are captured when you visit the My Stats page and cycle through all date filters.", page: "My Stats page" },
    { title: "Proposals", desc: "Opening a job in the sidebar captures all job and client details and saves the proposal to your history.", page: "Job detail sidebar" },
    { title: "Alerts", desc: "Messages, invites, and offers are captured when you visit Notifications or Messages.", page: "Notifications / Messages" },
    { title: "Profile", desc: "Title, rate, skills, and overview are saved when you visit your profile page.", page: "Your profile page" },
  ];
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">You don&apos;t need to do anything manually — the extension watches the pages you visit and sends data here in the background.</p>
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {cards.map((c) => (
          <div key={c.title} className="rounded-xl border border-gray-100 bg-gray-50 p-3 flex flex-col gap-2">
            <p className="text-xs font-semibold text-gray-900">{c.title}</p>
            <p className="text-xs text-gray-500 leading-relaxed flex-1">{c.desc}</p>
            <span className="inline-flex items-center gap-1 text-[10px] text-teal-700 bg-teal-50 border border-teal-100 rounded-full px-2 py-0.5 font-medium w-fit">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-2.5 h-2.5">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
              </svg>
              {c.page}
            </span>
          </div>
        ))}
      </div>
      {/* Stats filter callout */}
      <div className="rounded-xl border border-teal-100 bg-teal-50 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-teal-600 shrink-0">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          <p className="text-xs font-semibold text-teal-800">Daily habit: cycle through all filters on My Stats</p>
        </div>
        <p className="text-xs text-teal-700 leading-relaxed">
          When you visit the <strong>My Stats</strong> page on Upwork, the extension captures your proposal data — but only for the date range currently selected. To ensure the tracker has complete data across all time periods, switch through each filter every day:
        </p>
        <div className="flex flex-wrap gap-2">
          {["Last 7 days", "Last 30 days", "Last 90 days"].map((f) => (
            <span key={f} className="inline-flex items-center gap-1 text-[11px] font-semibold text-teal-700 bg-white border border-teal-200 rounded-full px-2.5 py-1">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-2.5 h-2.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              {f}
            </span>
          ))}
        </div>
        <p className="text-xs text-teal-600">
          Just click each filter option once — the extension picks up the data automatically as the page updates.
        </p>
      </div>
      <Note>Data syncs automatically while you browse — there&apos;s no sync button. Just use Upwork normally.</Note>
    </div>
  );
}

function SectionVerdicts() {
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">The extension evaluates every job in your feed against your team&apos;s bidding criteria and shows a verdict badge on each card — no need to open jobs individually.</p>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-green-100 bg-green-50 p-4">
          <span className="inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-md border bg-green-50 text-green-700 border-green-200 mb-2">✓ Worth applying</span>
          <p className="text-xs text-green-800 leading-relaxed">All required criteria passed — this client meets your team&apos;s standards.</p>
        </div>
        <div className="rounded-xl border border-red-100 bg-red-50 p-4">
          <span className="inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-md border bg-red-50 text-red-600 border-red-200 mb-2">✗ Not recommended</span>
          <p className="text-xs text-red-700 leading-relaxed">One or more required criteria failed — e.g. low rating, low total spend.</p>
        </div>
      </div>
      <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
        <p className="text-xs font-semibold text-gray-800 mb-1">What criteria are checked?</p>
        <p className="text-xs text-gray-500 leading-relaxed">Your admin configures the rules (minimum client rating, total spent, payment verification, etc.). The extension reads the client data visible on each card and evaluates instantly.</p>
      </div>
      <Tip>Open a job in the sidebar for the full breakdown — each criterion with its exact value. Feed badges give you a quick pass/fail to skip low-quality jobs at a glance.</Tip>
    </div>
  );
}

function SectionProposals() {
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">Every proposal you submit is tracked automatically. The extension captures job details, client info, and your cover letter.</p>
      <div className="space-y-2.5">
        <Step n={1}>Open a job from your feed — the extension reads the full job details (description, budget, client history) when the sidebar opens.</Step>
        <Step n={2}>Write your cover letter on the proposal page. Once you&apos;re ready, click <strong>Save to Tracker</strong> — this saves the proposal and unlocks the Send button.</Step>
        <Step n={3}>Click <strong>Send for X Connects</strong> to submit. The extension has already captured everything at this point.</Step>
        <Step n={4}>Your proposal appears in the dashboard with all details filled in — your admin can review it and leave coaching feedback.</Step>
      </div>

      {/* Save to Tracker callout */}
      <div className="rounded-xl border border-teal-100 bg-teal-50 p-4">
        <div className="flex items-center gap-2 mb-2">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-teal-600 shrink-0">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" />
          </svg>
          <p className="text-xs font-semibold text-teal-800">Save to Tracker comes before Send</p>
        </div>
        <p className="text-xs text-teal-700 leading-relaxed mb-3">
          The extension adds a <strong>Save to Tracker</strong> button on every proposal page. The <strong>Send</strong> button stays disabled until you click it — this ensures the tracker always captures your cover letter and job details before the proposal is submitted.
        </p>
        {/* Button mock */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center px-4 py-2 rounded-lg text-xs font-semibold bg-gray-100 text-gray-400 border border-gray-200 cursor-not-allowed select-none">
            Send for 20 Connects
          </span>
          <span className="inline-flex items-center px-4 py-2 rounded-lg text-xs font-semibold bg-gray-900 text-white select-none">
            Save to Tracker
          </span>
          <span className="text-xs text-gray-400 italic">← click this first</span>
        </div>
      </div>

      <div className="rounded-xl border border-red-100 bg-red-50 p-4">
        <p className="text-xs font-semibold text-red-700 mb-1">Unscanned Proposals</p>
        <p className="text-xs text-red-600 leading-relaxed">If you apply without opening the sidebar first, or with the extension disabled, the proposal will be missing its cover letter and client details. These appear in the <strong>Unscanned Proposals</strong> tab — go back and open those jobs on Upwork with the extension active to fill in the missing data.</p>
      </div>
    </div>
  );
}

function SectionNudges() {
  const steps = [
    { title: "A card appears in the extension popup", desc: "It shows the number of unscanned proposals, and a message: \"Open each one once so the tracker captures the cover letter and job details.\"" },
    { title: "Tap Open Proposals", desc: "This opens your unscanned proposals on Upwork one by one so the extension can read and capture each one automatically." },
    { title: "Or tap Dismiss", desc: "If you want to handle it later, dismiss the nudge. Your admin may send it again if proposals remain unscanned." },
  ];
  return (
    <div className="space-y-5">
      <p className="text-sm text-gray-500">When your admin sees that you have unscanned proposals, they can send you a <strong>Scan reminder</strong> nudge. It appears as a card directly inside the extension popup.</p>
      <div className="flex flex-col lg:flex-row gap-6 items-start">
        <NudgeMock />
        <div className="flex-1 space-y-3">
          <p className="text-xs font-semibold text-gray-700 uppercase tracking-wider">What happens when you receive a nudge</p>
          <div className="divide-y divide-gray-100">
            {steps.map((s) => (
              <div key={s.title} className="flex gap-3 py-2.5 first:pt-0 last:pb-0">
                <div className="shrink-0 mt-1 w-1.5 h-1.5 rounded-full bg-amber-400" />
                <div>
                  <p className="text-xs font-semibold text-gray-800">{s.title}</p>
                  <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
          <Tip>Don&apos;t ignore nudges — unscanned proposals mean your admin is working with incomplete data and can&apos;t give you accurate feedback.</Tip>
        </div>
      </div>
    </div>
  );
}

function SectionCoverage() {
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">Your stats (JSS, connects, conversion rates) only update when you visit specific Upwork pages. The <strong>Pages to open</strong> tab shows which ones still need a visit.</p>
      <div className="space-y-2.5">
        <Step n={1}>Check the <strong>Pages to open</strong> tab — it lists any pages you haven&apos;t visited within the required time window.</Step>
        <Step n={2}>Click <em>Open on Upwork</em> next to each page. The extension detects your visit automatically and marks it as covered.</Step>
        <Step n={3}>Keep coverage above 80%. A yellow banner appears on this dashboard when you fall below that threshold.</Step>
      </div>
      <Note>Coverage resets on a cooldown set by your admin (typically every few hours). Visiting once isn&apos;t permanent — make it a daily habit.</Note>
    </div>
  );
}

function SectionNotes() {
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">Your admin can leave coaching notes on your proposals — feedback on cover letters, bidding approach, or specific jobs. Unread notes show a count badge in the sidebar.</p>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-teal-100 bg-teal-50 p-4">
          <p className="text-xs font-semibold text-teal-800 mb-1">Unread note</p>
          <p className="text-xs text-teal-700 leading-relaxed">Highlighted in teal. Click <em>Mark as read</em> once reviewed. Notes linked to a proposal include a direct link to that job.</p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
          <p className="text-xs font-semibold text-gray-700 mb-1">Read note</p>
          <p className="text-xs text-gray-500 leading-relaxed">Shown in white once acknowledged. They stay in your history so you can refer back to past feedback anytime.</p>
        </div>
      </div>
      <Tip>Read coaching notes promptly — they&apos;re most useful while the proposal is fresh. Apply the feedback to your very next bid.</Tip>
    </div>
  );
}

function SectionTips() {
  const tips = [
    { title: "Keep the extension enabled at all times", body: "The extension only syncs while active. Disabling it or using a different browser means your stats won't be captured." },
    { title: "Always open a job before applying", body: "Click into a job to open the sidebar first. Proposals submitted without opening the sidebar are marked unscanned and missing key details." },
    { title: "Use suggestion badges to filter your feed", body: 'Red "Not recommended" badges flag clients who don\'t meet your team\'s standards — skip them to save connects for better opportunities.' },
    { title: "Check Pages to open daily", body: "Your stats only update when you visit required pages. Make it part of your daily routine to keep your numbers accurate." },
    { title: "Act on nudges quickly", body: "A nudge means your admin noticed missing data. Scanning those proposals quickly gives them what they need to give you better feedback." },
    { title: "Read coaching notes while context is fresh", body: "Notes are tied to specific proposals. Read them right away so you can apply the feedback to your next bid while the job is still in your head." },
  ];
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {tips.map((t) => (
        <div key={t.title} className="flex gap-3 p-3.5 rounded-xl border border-gray-100 hover:border-gray-200 transition-colors bg-gray-50">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 text-teal-500 shrink-0 mt-0.5">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <div>
            <p className="text-xs font-semibold text-gray-900">{t.title}</p>
            <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{t.body}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

const CONTENT: Record<SectionId, React.ReactNode> = {
  setup: <SectionSetup />,
  popup: <SectionPopup />,
  syncing: <SectionSyncing />,
  verdicts: <SectionVerdicts />,
  proposals: <SectionProposals />,
  nudges: <SectionNudges />,
  coverage: <SectionCoverage />,
  notes: <SectionNotes />,
  tips: <SectionTips />,
};

export function GuideView() {
  const [active, setActive] = useState<SectionId>("setup");
  const section = SECTIONS.find((s) => s.id === active)!;

  return (
    <div className="mt-6 pb-6 bg-white border border-gray-200 rounded-2xl overflow-hidden">
      {/* Horizontal tab strip */}
      <div className="border-b border-gray-100 overflow-x-auto overflow-y-hidden scrollbar-hide">
        <nav className="flex px-2 pt-2 gap-0.5">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setActive(s.id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors border-b-2 -mb-px ${
                active === s.id
                  ? "border-teal-500 text-teal-700"
                  : "border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-200"
              }`}
            >
              <span className={active === s.id ? "text-teal-500" : "text-gray-400"}>{s.icon}</span>
              {s.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Content */}
      <div className="p-6">
        {CONTENT[active]}
      </div>
    </div>
  );
}
