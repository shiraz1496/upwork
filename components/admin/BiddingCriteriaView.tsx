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
  const [editOrder, setEditOrder] = useState(0);
  const [saving, setSaving] = useState(false);

  const [confirmDelete, setConfirmDelete] = useState<Criterion | null>(null);
  const [deleting, setDeleting] = useState(false);

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
    setEditOrder(c.order);
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
          order: editOrder,
        }),
      });
      setEditing(null);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(c: Criterion) {
    await fetch(`/api/admin/bidding-criteria/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !c.active }),
    });
    await load();
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

  const inputClass = "border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-teal-500";
  const selectClass = `${inputClass} cursor-pointer`;

  return (
    <div className="py-6 flex flex-col gap-6">

      {/* Add form */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-900 mb-1">Add bidding criterion</h2>
        <p className="text-xs text-gray-400 mb-4">
          Define conditions a job must meet. Bidders will see a pass/fail checklist before submitting.
        </p>
        <form onSubmit={handleAdd} className="flex flex-col gap-3">
          <div className="flex gap-3 flex-wrap">
            {/* Field key */}
            <select
              value={key}
              onChange={(e) => { setKey(e.target.value); setValue(""); }}
              className={`${selectClass} flex-1 min-w-[180px]`}
            >
              {FIELD_OPTIONS.map((f) => (
                <option key={f.key} value={f.key}>{f.label}</option>
              ))}
            </select>

            {/* Operator (hidden for boolean) */}
            {!isBoolean && (
              <select
                value={operator}
                onChange={(e) => setOperator(e.target.value as Operator)}
                className={`${selectClass} w-20`}
              >
                {OPERATOR_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            )}

            {/* Value (hidden for boolean) */}
            {!isBoolean && (
              <div className="flex items-center gap-1.5">
                {selectedField?.unit === "$" && (
                  <span className="text-sm text-gray-400 font-medium">$</span>
                )}
                <input
                  type="number"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="Value"
                  min={0}
                  className={`${inputClass} w-28`}
                />
                {selectedField?.unit && selectedField.unit !== "$" && (
                  <span className="text-sm text-gray-400">{selectedField.unit}</span>
                )}
              </div>
            )}

            {/* Required toggle */}
            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none px-1">
              <input
                type="checkbox"
                checked={required}
                onChange={(e) => setRequired(e.target.checked)}
                className="rounded accent-teal-500"
              />
              Required
            </label>

            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 bg-teal-500 hover:bg-teal-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors shadow-sm whitespace-nowrap"
            >
              {submitting ? "Adding…" : "Add"}
            </button>
          </div>

          {formError && (
            <div className="rounded-lg bg-rose-50 border border-rose-100 px-3 py-2 text-xs text-rose-700">
              {formError}
            </div>
          )}
        </form>
      </div>

      {/* List */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">Criteria</h2>
          <span className="text-xs text-gray-400">{criteria.filter((c) => c.active).length} active</span>
        </div>

        {loading ? (
          <div className="px-6 py-8 text-sm text-gray-400">Loading…</div>
        ) : criteria.length === 0 ? (
          <div className="px-6 py-8 text-sm text-gray-400 text-center">
            No criteria yet. Add one above.
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {criteria.map((c) => (
              <li key={c.id} className={`flex items-center gap-4 px-6 py-4 ${!c.active ? "opacity-50" : ""}`}>
                {/* Pass/fail icon placeholder */}
                <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${c.active ? "bg-teal-50 text-teal-500" : "bg-gray-100 text-gray-400"}`}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-gray-900">{formatCriterion(c)}</span>
                    {c.required && (
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-rose-600 bg-rose-50 border border-rose-100 rounded px-1.5 py-0.5">
                        Required
                      </span>
                    )}
                    {!c.active && (
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 bg-gray-100 rounded px-1.5 py-0.5">
                        Inactive
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[11px] text-gray-400 font-mono">{c.key}</span>
                    <span className="text-[11px] text-gray-300">·</span>
                    <span className="text-[11px] text-gray-400">order {c.order}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => toggleActive(c)}
                    className="text-xs text-gray-400 hover:text-teal-600 border border-gray-200 hover:border-teal-300 rounded px-2 py-1 transition-colors"
                  >
                    {c.active ? "Disable" : "Enable"}
                  </button>
                  <button
                    onClick={() => openEdit(c)}
                    className="text-xs text-gray-500 hover:text-gray-700 border border-gray-200 hover:border-gray-300 rounded px-2 py-1 transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => setConfirmDelete(c)}
                    className="text-xs font-medium text-rose-600 border border-rose-200 rounded px-2 py-1 hover:bg-rose-50 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Edit modal */}
      {editing && (() => {
        const editMeta = fieldMeta(editKey);
        const editIsBool = editMeta?.type === "boolean";
        return (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setEditing(null)}>
            <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-base font-semibold text-gray-900">Edit criterion</h3>

              <div className="flex flex-col gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Field</label>
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
                      <label className="block text-xs font-medium text-gray-500 mb-1">Operator</label>
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
                      <label className="block text-xs font-medium text-gray-500 mb-1">Value</label>
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
                          <span className="text-sm text-gray-400">{editMeta.unit}</span>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-6">
                  <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={editRequired}
                      onChange={(e) => setEditRequired(e.target.checked)}
                      className="rounded accent-teal-500"
                    />
                    Required
                  </label>
                  <div className="flex items-center gap-2">
                    <label className="text-sm text-gray-600 whitespace-nowrap">Order</label>
                    <input
                      type="number"
                      value={editOrder}
                      onChange={(e) => setEditOrder(Math.max(0, Number(e.target.value)))}
                      min={0}
                      className={`${inputClass} w-16 text-center`}
                    />
                  </div>
                </div>
              </div>

              <div className="flex gap-3 mt-1">
                <button
                  onClick={() => setEditing(null)}
                  className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || (!editIsBool && !editValue.trim())}
                  className="flex-1 px-4 py-2 text-sm font-medium text-white bg-teal-500 hover:bg-teal-600 disabled:opacity-50 rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  {saving && <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
                  {saving ? "Saving…" : "Save changes"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Delete confirm */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setConfirmDelete(null)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-gray-900 mb-1">Delete criterion?</h3>
            <p className="text-sm text-gray-700 font-medium mb-4">{formatCriterion(confirmDelete)}</p>
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
