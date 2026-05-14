"use client";

import { useCallback, useEffect, useState } from "react";

type Operator = "gte" | "lte" | "eq";

type Criterion = {
  id: string;
  key: string;
  operator: Operator;
  value: string;
  required: boolean;
  active: boolean;
  order: number;
};

const FIELD_OPTIONS: { key: string; label: string; unit?: string; type: "number" | "boolean" | "string" }[] = [
  { key: "client_total_spent",      label: "Client Total Spent",      unit: "$",  type: "number" },
  { key: "client_rating",           label: "Client Rating",           unit: "/5", type: "number" },
  { key: "client_hire_rate",        label: "Client Hire Rate",        unit: "%",  type: "number" },
  { key: "client_reviews",          label: "Client Reviews",                      type: "number" },
  { key: "client_jobs_posted",      label: "Client Jobs Posted",                  type: "number" },
  { key: "client_hires",            label: "Client Hires",                        type: "number" },
  { key: "client_active_hires",     label: "Client Active Hires",                 type: "number" },
  { key: "client_payment_verified", label: "Payment Verified",                    type: "boolean" },
];

const OPERATOR_OPTIONS: { value: Operator; label: string }[] = [
  { value: "gte", label: "≥" },
  { value: "lte", label: "≤" },
  { value: "eq",  label: "=" },
];

function fieldMeta(key: string) {
  return FIELD_OPTIONS.find((f) => f.key === key);
}

function formatCriterion(c: Criterion): string {
  const meta = fieldMeta(c.key);
  const label = meta?.label ?? c.key;
  const op = OPERATOR_OPTIONS.find((o) => o.value === c.operator)?.label ?? c.operator;
  if (meta?.type === "boolean") return label;
  const unit = meta?.unit ?? "";
  const val = unit === "$" ? `$${c.value}` : `${c.value}${unit}`;
  return `${label} ${op} ${val}`;
}

function Spinner({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-block rounded-full border-2 border-current border-t-transparent animate-spin ${className}`} />
  );
}

export function BiddingCriteriaView() {
  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [loading, setLoading] = useState(true);

  const [key, setKey] = useState(FIELD_OPTIONS[0].key);
  const [operator, setOperator] = useState<Operator>("gte");
  const [value, setValue] = useState("");
  const [required, setRequired] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [editing, setEditing] = useState<Criterion | null>(null);
  const [editKey, setEditKey] = useState(FIELD_OPTIONS[0].key);
  const [editOperator, setEditOperator] = useState<Operator>("gte");
  const [editValue, setEditValue] = useState("");
  const [editRequired, setEditRequired] = useState(true);
  const [saving, setSaving] = useState(false);

  const [confirmDelete, setConfirmDelete] = useState<Criterion | null>(null);
  const [deleting, setDeleting] = useState(false);

  // per-row toggle loading
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/bidding-criteria");
    if (res.status === 401) {
      window.location.href = "/admin/login";
      return;
    }
    if (res.ok) {
      const data = await res.json();
      setCriteria(data.criteria || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const selectedField = fieldMeta(key);
  const isBoolean = selectedField?.type === "boolean";

  async function handleAdd(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    if (!isBoolean && !value.trim()) {
      setFormError("Value is required.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/bidding-criteria", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key,
          operator: isBoolean ? "eq" : operator,
          value: isBoolean ? "true" : value.trim(),
          required,
          order: criteria.length,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setFormError(body.error || `Error ${res.status}`);
        return;
      }
      setValue("");
      setRequired(true);
      await load();
    } catch {
      setFormError("Failed to add criterion.");
    } finally {
      setSubmitting(false);
    }
  }

  function openEdit(c: Criterion) {
    setEditing(c);
    setEditKey(c.key);
    setEditOperator(c.operator);
    setEditValue(c.value);
    setEditRequired(c.required);
  }

  async function handleSave() {
    if (!editing) return;
    const meta = fieldMeta(editKey);
    const isBool = meta?.type === "boolean";
    setSaving(true);
    try {
      await fetch(`/api/admin/bidding-criteria/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: editKey,
          operator: isBool ? "eq" : editOperator,
          value: isBool ? "true" : editValue.trim(),
          required: editRequired,
        }),
      });
      setEditing(null);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(c: Criterion) {
    setTogglingId(c.id);
    try {
      await fetch(`/api/admin/bidding-criteria/${c.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !c.active }),
      });
      await load();
    } finally {
      setTogglingId(null);
    }
  }

  async function handleDelete(id: string) {
    setDeleting(true);
    const res = await fetch(`/api/admin/bidding-criteria/${id}`, { method: "DELETE" });
    setDeleting(false);
    if (res.ok) {
      setConfirmDelete(null);
      await load();
    }
  }

  const inputClass = "border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-400 transition-colors";
  const selectClass = `${inputClass} cursor-pointer`;
  const activeCount = criteria.filter((c) => c.active).length;

  return (
    <div className="py-6 flex flex-col gap-5">

      {/* ── Add form ── */}
      <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
        <div className="mb-5">
          <h2 className="text-sm font-semibold text-gray-900">Add bidding criterion</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Define conditions a job must meet. Bidders will see a pass/fail checklist before applying.
          </p>
        </div>

        <form onSubmit={handleAdd}>
          <div className="flex gap-3 flex-wrap items-end">
            {/* Field */}
            <div className="flex-1 min-w-[200px]">
              <label className="block text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-1.5">Field</label>
              <select
                value={key}
                onChange={(e) => { setKey(e.target.value); setValue(""); }}
                className={`${selectClass} w-full`}
              >
                {FIELD_OPTIONS.map((f) => (
                  <option key={f.key} value={f.key}>{f.label}</option>
                ))}
              </select>
            </div>

            {!isBoolean && (
              <div>
                <label className="block text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-1.5">Operator</label>
                <select
                  value={operator}
                  onChange={(e) => setOperator(e.target.value as Operator)}
                  className={`${selectClass} w-20`}
                >
                  {OPERATOR_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            )}

            {!isBoolean && (
              <div>
                <label className="block text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-1.5">Value</label>
                <div className="flex items-center gap-1.5">
                  {selectedField?.unit === "$" && (
                    <span className="text-sm text-gray-400 font-medium">$</span>
                  )}
                  <input
                    type="number"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder="e.g. 4"
                    min={0}
                    className={`${inputClass} w-28`}
                  />
                  {selectedField?.unit && selectedField.unit !== "$" && (
                    <span className="text-sm text-gray-500 font-medium">{selectedField.unit}</span>
                  )}
                </div>
              </div>
            )}

            {/* Required toggle */}
            <div className="flex items-center h-[38px] gap-2 px-1">
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={required}
                  onChange={(e) => setRequired(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 rounded-full bg-gray-200 peer-checked:bg-teal-500 transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4" />
              </label>
              <span className="text-sm text-gray-600 select-none">Required</span>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="h-[38px] px-5 bg-teal-500 hover:bg-teal-600 disabled:opacity-60 text-white text-sm font-semibold rounded-lg transition-colors shadow-sm whitespace-nowrap flex items-center gap-2"
            >
              {submitting ? <><Spinner className="w-3.5 h-3.5 text-white/70" />Adding…</> : "Add criterion"}
            </button>
          </div>

          {formError && (
            <div className="mt-3 rounded-lg bg-rose-50 border border-rose-100 px-3 py-2 text-xs text-rose-700">
              {formError}
            </div>
          )}
        </form>
      </div>

      {/* ── Criteria list ── */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">Criteria</h2>
          <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${activeCount > 0 ? "bg-teal-50 text-teal-600" : "bg-gray-100 text-gray-400"}`}>
            {activeCount} active
          </span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-gray-400">
            <Spinner className="w-4 h-4 text-teal-400" />
            <span className="text-sm">Loading criteria…</span>
          </div>
        ) : criteria.length === 0 ? (
          <div className="py-16 text-center">
            <div className="mx-auto w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center mb-3">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 text-gray-400">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <p className="text-sm text-gray-500 font-medium">No criteria yet</p>
            <p className="text-xs text-gray-400 mt-1">Add your first criterion above.</p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {criteria.map((c) => (
              <li key={c.id} className={`flex items-center gap-4 px-6 py-4 transition-colors ${!c.active ? "bg-gray-50/60" : "hover:bg-gray-50/40"}`}>

                {/* Status dot */}
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-colors ${c.active ? "bg-teal-50 text-teal-500" : "bg-gray-100 text-gray-300"}`}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>

                {/* Content */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-sm font-semibold ${c.active ? "text-gray-900" : "text-gray-400"}`}>
                      {formatCriterion(c)}
                    </span>
                    {c.required && (
                      <span className="text-[10px] font-bold uppercase tracking-wider text-rose-500 bg-rose-50 border border-rose-100 rounded-md px-1.5 py-0.5">
                        Required
                      </span>
                    )}
                    {!c.active && (
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 bg-gray-100 border border-gray-200 rounded-md px-1.5 py-0.5">
                        Inactive
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-400 font-mono mt-0.5">{c.key}</p>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 shrink-0">
                  {/* Toggle */}
                  <button
                    onClick={() => toggleActive(c)}
                    disabled={togglingId === c.id}
                    className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-all disabled:opacity-60 ${
                      c.active
                        ? "text-gray-500 border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                        : "text-teal-600 border-teal-200 bg-teal-50 hover:bg-teal-100 hover:border-teal-300"
                    }`}
                  >
                    {togglingId === c.id
                      ? <><Spinner className="w-3 h-3" />{c.active ? "Disabling…" : "Enabling…"}</>
                      : c.active ? "Disable" : "Enable"
                    }
                  </button>

                  {/* Edit */}
                  <button
                    onClick={() => openEdit(c)}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 border border-gray-200 hover:border-gray-300 hover:bg-gray-50 px-3 py-1.5 rounded-lg transition-all"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                    Edit
                  </button>

                  {/* Delete */}
                  <button
                    onClick={() => setConfirmDelete(c)}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-500 border border-rose-200 hover:bg-rose-50 hover:border-rose-300 px-3 py-1.5 rounded-lg transition-all"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
                      <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                    </svg>
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── Edit modal ── */}
      {editing && (() => {
        const editMeta = fieldMeta(editKey);
        const editIsBool = editMeta?.type === "boolean";
        return (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setEditing(null)}>
            <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 flex flex-col gap-5" onClick={(e) => e.stopPropagation()}>
              <div>
                <h3 className="text-base font-semibold text-gray-900">Edit criterion</h3>
                <p className="text-xs text-gray-400 mt-0.5">Update the condition and save changes.</p>
              </div>

              <div className="flex flex-col gap-4">
                <div>
                  <label className="block text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-1.5">Field</label>
                  <select
                    value={editKey}
                    onChange={(e) => { setEditKey(e.target.value); setEditValue(""); }}
                    className={`w-full ${selectClass}`}
                  >
                    {FIELD_OPTIONS.map((f) => (
                      <option key={f.key} value={f.key}>{f.label}</option>
                    ))}
                  </select>
                </div>

                {!editIsBool && (
                  <div className="flex gap-3">
                    <div className="flex-none">
                      <label className="block text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-1.5">Operator</label>
                      <select
                        value={editOperator}
                        onChange={(e) => setEditOperator(e.target.value as Operator)}
                        className={`${selectClass} w-20`}
                      >
                        {OPERATOR_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex-1">
                      <label className="block text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-1.5">Value</label>
                      <div className="flex items-center gap-1.5">
                        {editMeta?.unit === "$" && <span className="text-sm text-gray-400 font-medium">$</span>}
                        <input
                          type="number"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          min={0}
                          className={`${inputClass} flex-1`}
                        />
                        {editMeta?.unit && editMeta.unit !== "$" && (
                          <span className="text-sm text-gray-500 font-medium">{editMeta.unit}</span>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                <label className="flex items-center gap-2 cursor-pointer select-none pt-1">
                  <div className="relative">
                    <input
                      type="checkbox"
                      checked={editRequired}
                      onChange={(e) => setEditRequired(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 rounded-full bg-gray-200 peer-checked:bg-teal-500 transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4" />
                  </div>
                  <span className="text-sm text-gray-600">Required</span>
                </label>
              </div>

              <div className="flex gap-3 pt-1">
                <button
                  onClick={() => setEditing(null)}
                  className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || (!editIsBool && !editValue.trim())}
                  className="flex-1 px-4 py-2.5 text-sm font-semibold text-white bg-teal-500 hover:bg-teal-600 disabled:opacity-50 rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  {saving ? <><Spinner className="w-3.5 h-3.5 text-white/70" />Saving…</> : "Save changes"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Delete confirm ── */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setConfirmDelete(null)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6" onClick={(e) => e.stopPropagation()}>
            <div className="w-10 h-10 rounded-full bg-rose-50 flex items-center justify-center mx-auto mb-4">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 text-rose-500">
                <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" />
              </svg>
            </div>
            <h3 className="text-base font-semibold text-gray-900 text-center mb-1">Delete criterion?</h3>
            <p className="text-sm text-center text-gray-500 mb-1">This will remove</p>
            <p className="text-sm font-semibold text-center text-gray-800 mb-5">"{formatCriterion(confirmDelete)}"</p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDelete(null)}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(confirmDelete.id)}
                disabled={deleting}
                className="flex-1 px-4 py-2.5 text-sm font-semibold text-white bg-rose-500 hover:bg-rose-600 disabled:opacity-60 rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                {deleting ? <><Spinner className="w-3.5 h-3.5 text-white/70" />Deleting…</> : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
