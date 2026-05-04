"use client";

import { useCallback, useEffect, useState } from "react";

type RequiredPage = {
  id: string;
  name: string;
  url: string;
  cooldownHours: number;
  createdAt: string;
  _count: { visits: number };
};

export function CoveragePagesView() {
  const [pages, setPages] = useState<RequiredPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [cooldownHours, setCooldownHours] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<RequiredPage | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [editingCooldown, setEditingCooldown] = useState<string | null>(null);
  const [editCooldownValue, setEditCooldownValue] = useState(1);
  const [savingCooldown, setSavingCooldown] = useState(false);

  const loadPages = useCallback(async () => {
    const res = await fetch("/api/admin/coverage-pages");
    if (res.status === 401) {
      window.location.href = "/admin/login";
      return;
    }
    if (res.ok) {
      const data = await res.json();
      setPages(data.pages || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadPages();
  }, [loadPages]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (!name.trim()) {
      setFormError("Page name is required.");
      return;
    }
    if (!url.trim() || !url.startsWith("https://")) {
      setFormError("URL is required and must start with https://.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/coverage-pages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), url: url.trim(), cooldownHours }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setFormError(body.error || `Error ${res.status}`);
        return;
      }
      setName("");
      setUrl("");
      setCooldownHours(1);
      await loadPages();
    } catch {
      setFormError("Failed to add page.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    setDeleting(true);
    const res = await fetch(`/api/admin/coverage-pages/${id}`, { method: "DELETE" });
    setDeleting(false);
    if (res.ok) {
      setConfirmDelete(null);
      await loadPages();
    }
  }

  async function handleSaveCooldown(id: string) {
    setSavingCooldown(true);
    try {
      await fetch(`/api/admin/coverage-pages/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cooldownHours: editCooldownValue }),
      });
      setEditingCooldown(null);
      await loadPages();
    } finally {
      setSavingCooldown(false);
    }
  }

  function fmtCooldown(h: number | undefined) {
    const hours = h ?? 1;
    if (hours === 1) return "1 hr";
    if (hours === 24) return "24 hrs (1 day)";
    if (hours % 24 === 0) return `${hours / 24} days`;
    return `${hours} hrs`;
  }

  return (
    <div className="py-6 flex flex-col gap-6">
      <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-900 mb-4">Add required page</h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex gap-3">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Page name"
              maxLength={100}
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="URL (must start with https://)"
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
            <div className="flex items-center gap-1.5 shrink-0">
              <input
                type="number"
                value={cooldownHours}
                onChange={(e) => setCooldownHours(Math.max(1, Math.min(168, Number(e.target.value))))}
                min={1}
                max={168}
                className="w-16 border border-gray-200 rounded-lg px-2 py-2 text-sm bg-white text-gray-700 text-center focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
              <span className="text-xs text-gray-400 whitespace-nowrap">hr cooldown</span>
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 bg-teal-500 hover:bg-teal-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors shadow-sm whitespace-nowrap"
            >
              {submitting ? "Adding…" : "Add page"}
            </button>
          </div>
          {formError && (
            <div className="rounded-lg bg-rose-50 border border-rose-100 px-3 py-2 text-xs text-rose-700">
              {formError}
            </div>
          )}
        </form>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">Required pages</h2>
        </div>

        {loading ? (
          <div className="px-6 py-8 text-sm text-gray-400">Loading…</div>
        ) : pages.length === 0 ? (
          <div className="px-6 py-8 text-sm text-gray-400 text-center">
            No required pages yet. Add one above.
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {pages.map((page) => (
              <li key={page.id} className="flex items-center justify-between gap-4 px-6 py-4">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-gray-900">{page.name}</div>
                  <a
                    href={page.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={page.url}
                    className="text-xs text-teal-600 hover:underline truncate block max-w-sm"
                  >
                    {page.url}
                  </a>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {/* <span className="text-xs text-gray-400">{page._count.visits} visit{page._count.visits !== 1 ? "s" : ""}</span> */}
                  {editingCooldown === page.id ? (
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        value={editCooldownValue}
                        onChange={(e) => setEditCooldownValue(Math.max(1, Math.min(168, Number(e.target.value))))}
                        min={1}
                        max={168}
                        className="w-14 border border-gray-200 rounded px-2 py-1 text-xs text-center focus:outline-none focus:ring-2 focus:ring-teal-500"
                        autoFocus
                      />
                      <span className="text-xs text-gray-400">hrs</span>
                      <button
                        onClick={() => handleSaveCooldown(page.id)}
                        disabled={savingCooldown}
                        className="px-2 py-1 text-xs font-medium text-white bg-teal-500 hover:bg-teal-600 disabled:opacity-50 rounded transition-colors"
                      >
                        {savingCooldown ? "…" : "Save"}
                      </button>
                      <button
                        onClick={() => setEditingCooldown(null)}
                        className="px-2 py-1 text-xs font-medium text-gray-500 hover:text-gray-700"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setEditingCooldown(page.id); setEditCooldownValue(page.cooldownHours ?? 1); }}
                      className="text-xs text-gray-400 hover:text-teal-600 border border-gray-200 hover:border-teal-300 rounded px-2 py-1 transition-colors"
                      title="Edit cooldown window"
                    >
                      {fmtCooldown(page.cooldownHours)}
                    </button>
                  )}
                  <button
                    onClick={() => setConfirmDelete(page)}
                    className="px-3 py-1.5 text-xs font-medium text-rose-600 border border-rose-200 rounded-lg hover:bg-rose-50 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {confirmDelete && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setConfirmDelete(null)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-gray-900 mb-1">Delete required page?</h3>
            <p className="text-sm text-gray-500 mb-1">
              <span className="font-medium text-gray-700">{confirmDelete.name}</span>
            </p>
            <p className="text-xs text-gray-400 mb-6">This will remove it from all bidders&apos; coverage tracking.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDelete(null)}
                className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(confirmDelete.id)}
                disabled={deleting}
                className="flex-1 px-4 py-2 text-sm font-medium text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-60 rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                {deleting && <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
