"use client";

import { useState } from "react";
import { Spinner } from "@/components/ui/Spinner";
import { ProvenanceBadge } from "@/components/me/ProvenanceBadge";
import { api, btnDanger, btnGhost, btnPrimary, card, input, useLoad } from "@/components/me/api";

type State = "DRAFT" | "READY" | "SUBMISSION_UNVERIFIED" | "SUBMITTED_CONFIRMED";

export type Proposal = {
  id: string;
  upworkJobId: string;
  jobUrl: string;
  jobTitle: string;
  coverLetter: string;
  bidType: "hourly" | "fixed";
  proposedRate: string | null;
  fixedBidAmount: string | null;
  state: State;
  submissionConfirmedAt: string | null;
  submittedBidAmount: string | null;
  submissionProvenance: string | null;
  updatedAt: string;
  events?: { fromState: State | null; toState: State; note: string | null; at: string }[];
};

// What a new proposal starts with (the Jobs tab passes the job the bidder picked).
export type ProposalSeed = { upworkJobId: string; jobUrl: string; jobTitle: string };

const STATE_STYLE: Record<State, { label: string; cls: string }> = {
  DRAFT: { label: "Draft", cls: "bg-gray-50 text-gray-600 border-gray-200" },
  READY: { label: "Ready to submit", cls: "bg-blue-50 text-blue-700 border-blue-200" },
  SUBMISSION_UNVERIFIED: { label: "Submitted", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  SUBMITTED_CONFIRMED: { label: "Submitted", cls: "bg-green-50 text-green-700 border-green-200" },
};

type FormValues = { jobUrl: string; jobTitle: string; coverLetter: string; bidType: "hourly" | "fixed"; amount: string };

function ProposalForm({
  initial,
  submitLabel,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  initial: FormValues;
  submitLabel: string;
  busy: boolean;
  error: string | null;
  onSubmit: (v: FormValues) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState<FormValues>(initial);
  const set = <K extends keyof FormValues>(k: K, value: FormValues[K]) => setV((prev) => ({ ...prev, [k]: value }));

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(v);
      }}
    >
      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium text-gray-700">Job link on Upwork</span>
          <input
            className={input}
            type="url"
            required
            placeholder="https://www.upwork.com/jobs/~02…"
            value={v.jobUrl}
            onChange={(e) => set("jobUrl", e.target.value)}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium text-gray-700">Job title</span>
          <input className={input} required maxLength={300} value={v.jobTitle} onChange={(e) => set("jobTitle", e.target.value)} />
        </label>
      </div>
      <label className="block text-sm">
        <span className="mb-1.5 block font-medium text-gray-700">Cover letter</span>
        <textarea
          className={`${input} min-h-40`}
          value={v.coverLetter}
          onChange={(e) => set("coverLetter", e.target.value)}
          placeholder="Write your cover letter here. You will paste it into Upwork yourself."
        />
      </label>
      <div className="grid grid-cols-2 gap-4 max-w-sm">
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium text-gray-700">Bid type</span>
          <select className={input} value={v.bidType} onChange={(e) => set("bidType", e.target.value as "hourly" | "fixed")}>
            <option value="hourly">Hourly</option>
            <option value="fixed">Fixed price</option>
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium text-gray-700">{v.bidType === "hourly" ? "Rate ($/hr)" : "Amount ($)"}</span>
          <input
            className={input}
            inputMode="decimal"
            placeholder="25"
            value={v.amount}
            onChange={(e) => set("amount", e.target.value)}
          />
        </label>
      </div>
      <div className="flex gap-2">
        <button type="submit" className={btnPrimary} disabled={busy}>
          {busy && <Spinner />}
          {submitLabel}
        </button>
        <button type="button" className={btnGhost} onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}

const amountFields = (v: FormValues) => ({
  bidType: v.bidType,
  proposedRate: v.bidType === "hourly" ? v.amount.trim() || null : null,
  fixedBidAmount: v.bidType === "fixed" ? v.amount.trim() || null : null,
});

export function ProposalsView({
  seed,
  onSeedUsed,
  onChanged,
}: {
  seed: ProposalSeed | null;
  onSeedUsed: () => void;
  onChanged: () => void;
}) {
  const [reloadKey, setReloadKey] = useState(0);
  const { data, error, loading } = useLoad<{ proposals: Proposal[] }>("/api/me/proposals", reloadKey);
  const [creating, setCreating] = useState(seed !== null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [rowMessage, setRowMessage] = useState<{ id: string; ok: boolean; text: string } | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const reload = () => {
    setReloadKey((k) => k + 1);
    onChanged();
  };

  async function create(v: FormValues) {
    setBusyId("new");
    setFormError(null);
    // The server works out the job id from the link, so the two can never disagree.
    const res = await api("POST", "/api/me/proposals", {
      jobUrl: v.jobUrl.trim(),
      jobTitle: v.jobTitle.trim(),
      coverLetter: v.coverLetter,
      ...amountFields(v),
    });
    setBusyId(null);
    if (!res.ok) return setFormError(res.error);
    setCreating(false);
    onSeedUsed();
    reload();
  }

  async function save(p: Proposal, v: FormValues) {
    setBusyId(p.id);
    setFormError(null);
    const res = await api("PATCH", `/api/me/proposals/${p.id}`, {
      jobUrl: v.jobUrl.trim(),
      jobTitle: v.jobTitle.trim(),
      coverLetter: v.coverLetter,
      ...amountFields(v),
    });
    setBusyId(null);
    if (!res.ok) return setFormError(res.error);
    setEditingId(null);
    reload();
  }

  async function act(p: Proposal, method: string, path: string, body: unknown, okText: (d: unknown) => string | null) {
    setBusyId(p.id);
    setRowMessage(null);
    const res = await api(method, `/api/me/proposals/${p.id}${path}`, body);
    setBusyId(null);
    setConfirmId(null);
    setDeleteId(null);
    if (!res.ok) return setRowMessage({ id: p.id, ok: false, text: res.error });
    const text = okText(res.data);
    if (text) setRowMessage({ id: p.id, ok: true, text });
    reload();
  }

  const verifyText = (d: unknown) => {
    const v = (d as { verification: string }).verification;
    if (v === "verified") return "Upwork confirms this proposal was submitted.";
    if (v === "disabled") return "Checking with Upwork is switched off for now. It stays self-reported.";
    return "Upwork's list does not show this proposal yet. It stays self-reported.";
  };

  const proposals = data?.proposals ?? [];

  return (
    <section className="mt-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">My proposals</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Write your proposal here, submit it yourself on Upwork, then confirm it. This app never submits for you.
          </p>
        </div>
        {!creating && (
          <button className={btnPrimary} onClick={() => { setCreating(true); setFormError(null); }}>
            New proposal
          </button>
        )}
      </div>

      {creating && (
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-semibold text-gray-900 mb-4">New proposal</h3>
          <ProposalForm
            initial={{ jobUrl: seed?.jobUrl ?? "", jobTitle: seed?.jobTitle ?? "", coverLetter: "", bidType: "hourly", amount: "" }}
            submitLabel="Save draft"
            busy={busyId === "new"}
            error={formError}
            onSubmit={create}
            onCancel={() => { setCreating(false); setFormError(null); onSeedUsed(); }}
          />
        </div>
      )}

      {loading && !data ? (
        <div className="py-6 text-sm text-gray-500">Loading…</div>
      ) : error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>
      ) : proposals.length === 0 && !creating ? (
        <div className={`${card} py-16 text-center text-sm text-gray-400`}>
          No proposals yet. Start one with &ldquo;New proposal&rdquo;.
        </div>
      ) : (
        <ul className="space-y-3">
          {proposals.map((p) => {
            const style = STATE_STYLE[p.state];
            const busy = busyId === p.id;
            const amount = p.bidType === "fixed" ? p.fixedBidAmount : p.proposedRate;
            const submitted = p.state === "SUBMISSION_UNVERIFIED" || p.state === "SUBMITTED_CONFIRMED";

            if (editingId === p.id) {
              return (
                <li key={p.id} className={`${card} p-5`}>
                  <h3 className="text-sm font-semibold text-gray-900 mb-4">Edit draft</h3>
                  <ProposalForm
                    initial={{ jobUrl: p.jobUrl, jobTitle: p.jobTitle, coverLetter: p.coverLetter, bidType: p.bidType, amount: amount ?? "" }}
                    submitLabel="Save changes"
                    busy={busy}
                    error={formError}
                    onSubmit={(v) => save(p, v)}
                    onCancel={() => { setEditingId(null); setFormError(null); }}
                  />
                </li>
              );
            }

            return (
              <li key={p.id} className={`${card} p-5`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <a href={p.jobUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-teal-700 hover:underline break-words">
                      {p.jobTitle}
                    </a>
                    <div className="mt-1 text-xs text-gray-500">
                      {amount ? `${p.bidType === "fixed" ? "Fixed" : "Hourly"} bid $${submitted ? (p.submittedBidAmount ?? amount) : amount}${p.bidType === "hourly" ? "/hr" : ""}` : "No bid amount yet"}
                      {submitted && p.submissionConfirmedAt && ` · confirmed ${new Date(p.submissionConfirmedAt).toLocaleString()}`}
                    </div>
                  </div>
                  <div className="shrink-0 flex items-center gap-2">
                    {submitted && <ProvenanceBadge provenance={p.submissionProvenance} />}
                    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${style.cls}`}>{style.label}</span>
                  </div>
                </div>

                {p.coverLetter && (
                  <p className="mt-3 text-sm text-gray-700 whitespace-pre-wrap line-clamp-4">{p.coverLetter}</p>
                )}

                {rowMessage?.id === p.id && (
                  <div role="status" className={`mt-3 rounded-lg border px-3 py-2 text-sm ${rowMessage.ok ? "border-green-200 bg-green-50 text-green-800" : "border-rose-200 bg-rose-50 text-rose-700"}`}>
                    {rowMessage.text}
                  </div>
                )}

                {confirmId === p.id ? (
                  <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">
                    <p className="text-amber-900">
                      Only confirm after you have submitted this proposal on Upwork yourself. It will be recorded as
                      self-reported, and it cannot be edited or deleted afterwards.
                    </p>
                    <div className="mt-3 flex gap-2">
                      <button className={btnPrimary} disabled={busy} onClick={() => act(p, "POST", "/confirm", {}, () => "Recorded as submitted (self-reported).")}>
                        {busy && <Spinner />}
                        Yes, I submitted it on Upwork
                      </button>
                      <button className={btnGhost} disabled={busy} onClick={() => setConfirmId(null)}>Cancel</button>
                    </div>
                  </div>
                ) : deleteId === p.id ? (
                  <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm">
                    <p className="text-rose-800">Delete this proposal draft? This cannot be undone.</p>
                    <div className="mt-3 flex gap-2">
                      <button className={btnDanger} disabled={busy} onClick={() => act(p, "DELETE", "", undefined, () => null)}>
                        {busy && <Spinner />}
                        Delete
                      </button>
                      <button className={btnGhost} disabled={busy} onClick={() => setDeleteId(null)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    {p.state === "DRAFT" && (
                      <>
                        <button className={btnPrimary} disabled={busy} onClick={() => act(p, "PATCH", "", { state: "READY" }, () => null)}>
                          {busy && <Spinner />}
                          Mark ready
                        </button>
                        <button className={btnGhost} disabled={busy} onClick={() => { setEditingId(p.id); setFormError(null); setRowMessage(null); }}>Edit</button>
                        <button className={btnDanger} disabled={busy} onClick={() => setDeleteId(p.id)}>Delete</button>
                      </>
                    )}
                    {p.state === "READY" && (
                      <>
                        <a className={btnPrimary} href={p.jobUrl} target="_blank" rel="noopener noreferrer">Open on Upwork</a>
                        <button className={btnGhost} disabled={busy} onClick={() => setConfirmId(p.id)}>I submitted it</button>
                        <button className={btnGhost} disabled={busy} onClick={() => act(p, "PATCH", "", { state: "DRAFT" }, () => null)}>Back to draft</button>
                        <button className={btnDanger} disabled={busy} onClick={() => setDeleteId(p.id)}>Delete</button>
                      </>
                    )}
                    {p.state === "SUBMISSION_UNVERIFIED" && (
                      <button className={btnGhost} disabled={busy} onClick={() => act(p, "POST", "/verify", undefined, verifyText)}>
                        {busy && <Spinner />}
                        Check with Upwork
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
