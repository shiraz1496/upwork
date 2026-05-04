"use client";

import { useEffect, useRef, useState } from "react";
import { Spinner } from "@/components/ui/Spinner";

type MemberStats = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "bidder";
  status: "active" | "inactive";
  captured: { proposals: number; jobs: number; alerts: number; snapshots: number };
  coverage: { referenced: number; captured: number; pct: number };
  latestCaptureAt: string | null;
};

export function TeamStatsView() {
  const [members, setMembers] = useState<MemberStats[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [composingFor, setComposingFor] = useState<MemberStats | null>(null);
  const [noteBody, setNoteBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  async function load() {
    try {
      const r = await fetch("/api/admin/team-stats", { cache: "no-store" });
      if (r.status === 401) {
        window.location.href = "/admin/login";
        return;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setMembers(data.members);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function sendNote(e: React.FormEvent) {
    e.preventDefault();
    if (!composingFor) return;
    setSending(true);
    setSendError(null);
    try {
      const res = await fetch("/api/admin/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientId: composingFor.id, body: noteBody }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setComposingFor(null);
      setNoteBody("");
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="p-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">
          Team Stats
          {members && (
            <span className="ml-2 text-gray-400 font-normal">({members.length})</span>
          )}
        </h2>
      </div>

      {error && (
        <div className="rounded-lg bg-rose-50 border border-rose-100 p-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      {members === null ? (
        <div className="bg-white border border-gray-200 rounded-xl p-12 text-center text-sm text-gray-500">
          Loading…
        </div>
      ) : members.length === 0 ? (
        <div className="bg-white border border-dashed border-gray-300 rounded-xl p-12 text-center text-sm text-gray-500">
          No team members yet.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {members.map((m) => (
            <div
              key={m.id}
              className="bg-white border border-gray-200 rounded-xl p-5 flex flex-col"
            >
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium text-gray-900 truncate">{m.name}</div>
                  <div className="text-xs text-gray-500 truncate">{m.email}</div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                      m.status === "active"
                        ? "bg-green-50 text-green-700 border border-green-100"
                        : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {m.status}
                  </span>
                  <span className="rounded-full bg-gray-100 text-gray-700 px-2.5 py-0.5 text-[11px] font-medium">
                    {m.role}
                  </span>
                </div>
              </div>

              <div className="mb-4">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-gray-500 uppercase tracking-wider" title="Required pages visited within their cooldown window">Pages covered</span>
                  <span className="text-gray-600">
                    {m.coverage.captured} / {m.coverage.referenced}
                  </span>
                </div>
                <div className="mt-2 h-2 rounded-full bg-gray-100 overflow-hidden">
                  <div
                    className="h-2 rounded-full bg-teal-500 transition-all"
                    style={{ width: `${m.coverage.pct}%` }}
                  />
                </div>
                <div className="mt-1.5 text-right text-sm font-semibold text-gray-900">
                  {m.coverage.pct}%
                </div>
              </div>

              <div className="grid grid-cols-4 gap-2">
                <StatCell label="Props" value={m.captured.proposals} color="text-blue-600" />
                <StatCell label="Jobs" value={m.captured.jobs} color="text-amber-600" />
                <StatCell label="Alerts" value={m.captured.alerts} color="text-purple-600" />
                <StatCell label="Snaps" value={m.captured.snapshots} color="text-teal-600" />
              </div>

              <div className="mt-4 text-[11px] text-gray-400">
                Last capture:{" "}
                {m.latestCaptureAt ? new Date(m.latestCaptureAt).toLocaleString() : "—"}
              </div>

              <button
                onClick={() => {
                  setComposingFor(m);
                  setNoteBody("");
                  setSendError(null);
                }}
                className="mt-4 w-full px-3 py-2 bg-white border border-gray-200 text-gray-700 text-xs font-medium rounded-lg hover:bg-gray-50 shadow-sm transition-colors"
              >
                Leave note
              </button>
            </div>
          ))}
        </div>
      )}

      <NoteModal
        open={composingFor !== null}
        recipientName={composingFor?.name || ""}
        body={noteBody}
        setBody={setNoteBody}
        sending={sending}
        error={sendError}
        onClose={() => setComposingFor(null)}
        onSubmit={sendNote}
      />
    </div>
  );
}

function StatCell({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-lg bg-gray-50 py-2.5 text-center">
      <div className={`text-base font-semibold ${color}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-gray-500 mt-0.5">{label}</div>
    </div>
  );
}

function NoteModal({
  open,
  recipientName,
  body,
  setBody,
  sending,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean;
  recipientName: string;
  body: string;
  setBody: (v: string) => void;
  sending: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (open && !dlg.open) dlg.showModal();
    if (!open && dlg.open) dlg.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="m-auto w-full max-w-md rounded-xl p-0 backdrop:bg-black/40 shadow-2xl"
    >
      <div className="p-6">
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">Note to {recipientName}</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            ✕
          </button>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            required
            rows={5}
            placeholder="Write your note. Keep it actionable."
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none"
          />
          {error && (
            <div className="rounded-lg bg-rose-50 border border-rose-100 p-3 text-xs text-rose-700">
              {error}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-white border border-gray-200 text-gray-700 text-sm rounded-lg hover:bg-gray-50 shadow-sm transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={sending || body.trim().length === 0}
              className="inline-flex items-center gap-2 px-4 py-2 bg-teal-500 hover:bg-teal-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors shadow-sm"
            >
              {sending && <Spinner />}
              {sending ? "Sending…" : "Send"}
            </button>
          </div>
        </form>
      </div>
    </dialog>
  );
}
