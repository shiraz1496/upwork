"use client";

import { useState } from "react";
import { Spinner } from "@/components/ui/Spinner";
import { ProvenanceBadge } from "@/components/me/ProvenanceBadge";
import type { Proposal } from "@/components/me/ProposalsView";
import { api, btnGhost, btnPrimary, card, input, useLoad } from "@/components/me/api";

type Reply = {
  id: string;
  kind: string;
  snippet: string | null;
  receivedAt: string | null;
  provenance: string;
  associationMethod: string;
  needsManualAssociation: boolean;
  proposal: { id: string; jobTitle: string } | null;
};

// Client replies read from the bidder's own Upwork messages. A reply is only tied to a
// proposal when Upwork itself links them; otherwise the bidder picks the proposal here.
export function RepliesView({ onChanged }: { onChanged: () => void }) {
  const [reloadKey, setReloadKey] = useState(0);
  const replies = useLoad<{ responses: Reply[] }>("/api/me/responses", reloadKey);
  const proposals = useLoad<{ proposals: Proposal[] }>("/api/me/proposals", reloadKey);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const submitted = (proposals.data?.proposals ?? []).filter(
    (p) => p.state === "SUBMISSION_UNVERIFIED" || p.state === "SUBMITTED_CONFIRMED",
  );

  async function link(reply: Reply, draftId: string | null) {
    setBusyId(reply.id);
    setMessage(null);
    const res = await api("PATCH", `/api/me/responses/${reply.id}`, { draftId });
    setBusyId(null);
    if (!res.ok) return setMessage({ ok: false, text: res.error });
    setReloadKey((k) => k + 1);
    onChanged();
  }

  async function refresh() {
    setBusyId("refresh");
    setMessage(null);
    const res = await api<{ status: string; detail?: string; stored?: number; provenance?: string }>("POST", "/api/me/responses/sync");
    setBusyId(null);
    if (!res.ok) return setMessage({ ok: false, text: res.error });
    if (res.data.status === "disabled") return setMessage({ ok: false, text: res.data.detail ?? "Reading replies from Upwork is switched off." });
    setMessage({
      ok: true,
      text: res.data.provenance === "MOCK" ? "Test mode: nothing was saved." : `${res.data.stored ?? 0} new client repl${res.data.stored === 1 ? "y" : "ies"}.`,
    });
    setReloadKey((k) => k + 1);
    onChanged();
  }

  const rows = replies.data?.responses ?? [];

  return (
    <section className="mt-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Client replies</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Conversations where the client wrote last. Read from your Upwork messages only when you press refresh.
          </p>
        </div>
        <button className={btnPrimary} onClick={refresh} disabled={busyId !== null}>
          {busyId === "refresh" && <Spinner />}
          {busyId === "refresh" ? "Refreshing…" : "Refresh replies"}
        </button>
      </div>

      {message && (
        <div role="status" className={`rounded-xl border px-4 py-2.5 text-sm ${message.ok ? "border-green-200 bg-green-50 text-green-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
          {message.text}
        </div>
      )}

      {replies.loading && !replies.data ? (
        <div className="py-6 text-sm text-gray-500">Loading…</div>
      ) : replies.error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{replies.error}</div>
      ) : rows.length === 0 ? (
        <div className={`${card} py-16 text-center text-sm text-gray-400`}>No client replies saved yet.</div>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.id} className={`${card} p-5`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex rounded-full border border-purple-200 bg-purple-50 px-2.5 py-0.5 text-[11px] font-medium text-purple-700 capitalize">
                      {r.kind}
                    </span>
                    <ProvenanceBadge provenance={r.provenance} />
                    <span className="text-xs text-gray-400">{r.receivedAt ? new Date(r.receivedAt).toLocaleString() : "time unknown"}</span>
                  </div>
                  {/* Plain text only: this is content written by someone outside the team. */}
                  <p className="mt-2 text-sm text-gray-700 whitespace-pre-wrap break-words">{r.snippet ?? "Preview no longer stored."}</p>
                </div>
              </div>

              <div className="mt-4 border-t border-gray-100 pt-3">
                {r.proposal ? (
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-gray-500">Proposal:</span>
                    <span className="font-medium text-gray-900">{r.proposal.jobTitle}</span>
                    <span className="text-[11px] text-gray-400">
                      ({r.associationMethod === "verified_identifier" ? "linked by Upwork" : "linked by you"})
                    </span>
                    <button className={btnGhost} disabled={busyId !== null} onClick={() => link(r, null)}>
                      {busyId === r.id && <Spinner />}
                      Unlink
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-amber-700 font-medium">Needs linking to a proposal</span>
                    {submitted.length === 0 ? (
                      <span className="text-xs text-gray-400">You have no submitted proposals to link it to.</span>
                    ) : (
                      <>
                        <select
                          className={`${input} max-w-xs`}
                          aria-label="Proposal to link"
                          value={choice[r.id] ?? ""}
                          onChange={(e) => setChoice((c) => ({ ...c, [r.id]: e.target.value }))}
                        >
                          <option value="">Choose a proposal…</option>
                          {submitted.map((p) => (
                            <option key={p.id} value={p.id}>{p.jobTitle}</option>
                          ))}
                        </select>
                        <button className={btnPrimary} disabled={!choice[r.id] || busyId !== null} onClick={() => link(r, choice[r.id])}>
                          {busyId === r.id && <Spinner />}
                          Link
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
