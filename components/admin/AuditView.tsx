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
    if (res.status === 401) {
      window.location.href = "/admin/login";
      return;
    }
    const data = await res.json();
    setLogs(data.logs);
    setTotal(data.total);
    setEvents(data.events);
    setMembers(data.members);
    setLoading(false);
  }, [eventFilter, actorFilter, offset]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
            Audit Log
            <span className="ml-2 text-gray-400 font-normal">({total})</span>
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">Events matching current filters.</p>
        </div>
        <button
          onClick={() => {
            setEventFilter("");
            setActorFilter("");
            setOffset(0);
          }}
          className="px-3 py-1.5 bg-white border border-gray-200 text-gray-700 text-xs rounded-lg hover:bg-gray-50 shadow-sm transition-colors"
        >
          Reset filters
        </button>
      </div>

      <div className="flex gap-3">
        <select
          value={eventFilter}
          onChange={(e) => {
            setEventFilter(e.target.value);
            setOffset(0);
          }}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-teal-500"
        >
          <option value="">All events</option>
          {events.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>
        <select
          value={actorFilter}
          onChange={(e) => {
            setActorFilter(e.target.value);
            setOffset(0);
          }}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-teal-500"
        >
          <option value="">All actors</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wider text-gray-500">
            <tr>
              <th className="px-5 py-3 font-medium">Time</th>
              <th className="px-5 py-3 font-medium">Event</th>
              <th className="px-5 py-3 font-medium">Actor</th>
              <th className="px-5 py-3 font-medium">Subject</th>
              <th className="px-5 py-3 font-medium">Meta</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && (
              <tr>
                <td colSpan={5} className="px-5 py-8 text-center text-sm text-gray-500">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && logs.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-8 text-center text-sm text-gray-500">
                  No events
                </td>
              </tr>
            )}
            {logs.map((log) => (
              <tr key={log.id} className="align-top hover:bg-gray-50">
                <td className="px-5 py-3 whitespace-nowrap text-xs text-gray-500">
                  {new Date(log.createdAt).toLocaleString()}
                </td>
                <td className="px-5 py-3 font-mono text-xs text-gray-700">{log.event}</td>
                <td className="px-5 py-3 text-xs text-gray-700">{log.actor?.name || "—"}</td>
                <td className="px-5 py-3 text-xs text-gray-500">
                  {log.subjectType && <span>{log.subjectType}: </span>}
                  {log.subjectId && (
                    <span className="font-mono">{log.subjectId.slice(0, 10)}…</span>
                  )}
                </td>
                <td className="px-5 py-3 text-xs">
                  {log.meta ? (
                    <pre className="max-w-xs overflow-hidden whitespace-pre-wrap text-gray-600">
                      {JSON.stringify(log.meta)}
                    </pre>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {total > 50 && (
        <div className="flex items-center justify-between text-sm">
          <button
            onClick={() => setOffset(Math.max(0, offset - 50))}
            disabled={offset === 0}
            className="px-3 py-1.5 bg-white border border-gray-200 text-gray-700 text-xs rounded-lg hover:bg-gray-50 disabled:opacity-50 shadow-sm transition-colors"
          >
            Prev
          </button>
          <span className="text-gray-500">
            {offset + 1}–{Math.min(offset + 50, total)} of {total}
          </span>
          <button
            onClick={() => setOffset(offset + 50)}
            disabled={offset + 50 >= total}
            className="px-3 py-1.5 bg-white border border-gray-200 text-gray-700 text-xs rounded-lg hover:bg-gray-50 disabled:opacity-50 shadow-sm transition-colors"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
