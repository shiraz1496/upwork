"use client";

import { useCallback, useEffect, useState } from "react";

type Log = {
  id: string;
  event: string;
  actor: { id: string; name: string } | null;
  subjectType: string | null;
  subjectId: string | null;
  meta: Record<string, unknown> | null;
  createdAt: string;
};

const EVENT_LABELS: Record<string, string> = {
  "member.created": "Created member",
  "member.updated": "Updated member",
  "member.status_changed": "Changed member status",
  "token.issued": "Issued token",
  "token.revoked": "Revoked token",
  "page.added": "Added required page",
  "page.deleted": "Deleted required page",
  "note.sent": "Sent coaching note",
  "sync.skipped_record": "Skipped record (sync)",
  "coverage.captured": "Captured coverage item",
};

function fmtEvent(event: string): string {
  return EVENT_LABELS[event] ?? event.replace(/[._]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function MetaCell({ meta }: { meta: Record<string, unknown> | null }) {
  if (!meta) return <span className="text-gray-400">—</span>;
  const entries = Object.entries(meta).filter(([, v]) => v != null && v !== "");
  if (entries.length === 0) return <span className="text-gray-400">—</span>;
  return (
    <div className="flex flex-col gap-0.5">
      {entries.slice(0, 4).map(([k, v]) => (
        <span key={k} className="text-xs text-gray-500">
          <span className="text-gray-400 font-medium">{k}:</span>{" "}
          <span className="text-gray-600">{String(v).slice(0, 60)}{String(v).length > 60 ? "…" : ""}</span>
        </span>
      ))}
    </div>
  );
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function AuditView() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [total, setTotal] = useState(0);
  const [events, setEvents] = useState<string[]>([]);
  const [members, setMembers] = useState<{ id: string; name: string }[]>([]);
  const [eventFilter, setEventFilter] = useState("");
  const [actorFilter, setActorFilter] = useState("");
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (eventFilter) params.set("event", eventFilter);
    if (actorFilter) params.set("actorId", actorFilter);
    params.set("offset", String(offset));
    params.set("limit", "50");
    const res = await fetch(`/api/admin/audit?${params}`, { cache: "no-store" });
    if (res.status === 401) { window.location.href = "/admin/login"; return; }
    const data = await res.json();
    setLogs(data.logs);
    setTotal(data.total);
    setEvents(data.events);
    setMembers(data.members);
    setLoading(false);
  }, [eventFilter, actorFilter, offset]);

  useEffect(() => { load(); }, [load]);

  const hasFilters = eventFilter || actorFilter;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-gray-900">
              Audit Log
              <span className="ml-2 text-gray-400 font-normal">({total})</span>
            </h2>
            {loading && logs.length > 0 && (
              <svg className="w-4 h-4 text-gray-400 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
              </svg>
            )}
          </div>
          <p className="text-sm text-gray-500 mt-0.5">All admin and system events.</p>
        </div>
        {hasFilters && (
          <button
            onClick={() => { setEventFilter(""); setActorFilter(""); setOffset(0); }}
            className="px-3 py-1.5 bg-white border border-gray-200 text-gray-700 text-xs rounded-lg hover:bg-gray-50 shadow-sm transition-colors"
          >
            Clear filters
          </button>
        )}
      </div>

      <div className="flex gap-3 flex-wrap">
        <select
          value={eventFilter}
          onChange={(e) => { setEventFilter(e.target.value); setOffset(0); }}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-teal-500"
        >
          <option value="">All events</option>
          {events.map((e) => (
            <option key={e} value={e}>{fmtEvent(e)}</option>
          ))}
        </select>
        <select
          value={actorFilter}
          onChange={(e) => { setActorFilter(e.target.value); setOffset(0); }}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-teal-500"
        >
          <option value="">All actors</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wider text-gray-500">
            <tr>
              <th className="px-5 py-3 font-medium whitespace-nowrap">Time</th>
              <th className="px-5 py-3 font-medium">Event</th>
              <th className="px-5 py-3 font-medium">Actor</th>
              <th className="px-5 py-3 font-medium">Subject</th>
              <th className="px-5 py-3 font-medium">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && logs.length === 0 && (
              <tr><td colSpan={5} className="px-5 py-10 text-center text-sm text-gray-400">Loading…</td></tr>
            )}
            {!loading && logs.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center">
                  <p className="text-sm text-gray-500 font-medium">No events found</p>
                  {hasFilters && <p className="text-xs text-gray-400 mt-1">Try clearing your filters.</p>}
                </td>
              </tr>
            )}
            {logs.map((log) => (
              <tr key={log.id} className="align-top hover:bg-gray-50 transition-colors">
                <td className="px-5 py-3 whitespace-nowrap text-xs text-gray-400">{fmtTime(log.createdAt)}</td>
                <td className="px-5 py-3 text-xs font-medium text-gray-800">{fmtEvent(log.event)}</td>
                <td className="px-5 py-3 text-xs text-gray-600">{log.actor?.name || <span className="text-gray-400">System</span>}</td>
                <td className="px-5 py-3 text-xs text-gray-500">
                  {log.subjectType && <span className="text-gray-400">{log.subjectType}</span>}
                  {log.subjectId && <span className="font-mono ml-1 text-gray-400">{log.subjectId.slice(0, 8)}…</span>}
                  {!log.subjectType && !log.subjectId && <span className="text-gray-300">—</span>}
                </td>
                <td className="px-5 py-3"><MetaCell meta={log.meta} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {total > 50 && (
        <div className="flex items-center justify-between">
          <button
            onClick={() => setOffset(Math.max(0, offset - 50))}
            disabled={offset === 0}
            className="px-3 py-1.5 bg-white border border-gray-200 text-gray-700 text-xs rounded-lg hover:bg-gray-50 disabled:opacity-40 shadow-sm transition-colors"
          >
            ← Previous
          </button>
          <span className="text-xs text-gray-500">{offset + 1}–{Math.min(offset + 50, total)} of {total}</span>
          <button
            onClick={() => setOffset(offset + 50)}
            disabled={offset + 50 >= total}
            className="px-3 py-1.5 bg-white border border-gray-200 text-gray-700 text-xs rounded-lg hover:bg-gray-50 disabled:opacity-40 shadow-sm transition-colors"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
