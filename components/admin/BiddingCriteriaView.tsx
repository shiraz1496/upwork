"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import { COUNTRY_LIST } from "@/lib/countries";

type Operator = "gte" | "lte" | "eq" | "neq";

type Criterion = {
  id: string;
  key: string;
  operator: Operator;
  value: string;
  required: boolean;
  active: boolean;
  order: number;
};

const FIELD_OPTIONS: { key: string; label: string; unit?: string; type: "number" | "boolean" | "string"; integer?: boolean }[] = [
  { key: "client_total_spent",      label: "Client Total Spent",      unit: "$",  type: "number"                  },
  { key: "client_rating",           label: "Client Rating",           unit: "/5", type: "number"                  },
  { key: "client_hire_rate",        label: "Client Hire Rate",        unit: "%",  type: "number"                  },
  { key: "client_reviews",          label: "Client Reviews",                      type: "number", integer: true   },
  { key: "client_jobs_posted",      label: "Client Jobs Posted",                  type: "number", integer: true   },
  { key: "client_hires",            label: "Client Hires",                        type: "number", integer: true   },
  { key: "client_active_hires",     label: "Client Active Hires",                 type: "number", integer: true   },
  { key: "client_payment_verified", label: "Payment Verified",                    type: "boolean"                 },
  { key: "client_country",          label: "Client Country (Blocked)",            type: "string"                  },
  { key: "job_interviewing",        label: "Interviewing Count",                  type: "number", integer: true   },
  { key: "job_proposals",           label: "Proposals Count",                     type: "number", integer: true   },
  { key: "job_hires",               label: "Hires (this job)",                    type: "number", integer: true   },
  { key: "job_last_viewed",         label: "Last Viewed (hours ago)",  unit: "h", type: "number"                  },
  { key: "job_skill_match",         label: "Skill Match (count)",                 type: "number", integer: true   },
];

const OPERATOR_OPTIONS: { value: Operator; label: string; symbol: string }[] = [
  { value: "gte", label: "At least (≥)", symbol: "≥" },
  { value: "lte", label: "At most (≤)",  symbol: "≤" },
  { value: "eq",  label: "Exactly (=)",  symbol: "=" },
  { value: "neq", label: "Not (≠)",      symbol: "≠" },
];

const DEFAULT_OPERATOR: Record<string, Operator> = {
  client_total_spent:      "gte",
  client_rating:           "gte",
  client_hire_rate:        "gte",
  client_reviews:          "gte",
  client_jobs_posted:      "gte",
  client_hires:            "gte",
  client_active_hires:     "gte",
  job_interviewing:        "lte",
  job_proposals:           "lte",
  job_hires:               "eq",
  job_last_viewed:         "lte",
  job_skill_match:         "gte",
};

function fieldMeta(key: string) {
  return FIELD_OPTIONS.find((f) => f.key === key);
}

function formatCriterion(c: Criterion): string {
  const meta = fieldMeta(c.key);
  const label = meta?.label ?? c.key;
  const op = OPERATOR_OPTIONS.find((o) => o.value === c.operator)?.symbol ?? c.operator;
  if (meta?.type === "boolean") return label;
  if (meta?.type === "string") {
    const countries = c.value.split(",").map((s) => s.trim()).filter(Boolean);
    return `Blocked: ${countries.join(", ")}`;
  }
  const unit = meta?.unit ?? "";
  const val = unit === "$" ? `$${c.value}` : `${c.value}${unit}`;
  return `${label} ${op} ${val}`;
}

function Spinner({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-block rounded-full border-2 border-current border-t-transparent animate-spin ${className}`} />
  );
}

function SearchableSelect({
  options,
  value,
  onChange,
  placeholder,
  className = ""
}: {
  options: string[];
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filtered = options.filter(o => o.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className={`relative ${className}`} ref={ref}>
      <input
        type="text"
        value={open ? query : value}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          setOpen(true);
          setQuery("");
        }}
        placeholder={value || placeholder}
        className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 pr-8 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-teal-500"
      />
      <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-gray-400">
          <polyline points="6 9 10 13 14 9" />
        </svg>
      </div>
      {open && (
        <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-auto">
          {filtered.length === 0 ? (
            <div className="p-2 text-sm text-gray-500 text-center">No results found.</div>
          ) : (
            filtered.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => {
                  onChange(opt);
                  setOpen(false);
                  setQuery("");
                }}
                className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-teal-50 hover:text-teal-700 transition-colors"
              >
                {opt}
              </button>
            ))
          )}
        </div>
      )}
    </div>
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
  const [editCountryAdd, setEditCountryAdd] = useState("");
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
  const isString  = selectedField?.type === "string";

  async function handleAdd(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    if (!isBoolean && !value.trim()) {
      setFormError(isString ? "Please select a country." : "Value is required.");
      return;
    }
    // Block duplicate fields (except country which merges)
    if (key !== "client_country" && criteria.some((c) => c.key === key)) {
      setFormError("A criterion for this field already exists. Edit the existing one instead.");
      return;
    }

    setSubmitting(true);
    try {
      // Countries: merge into one criterion row instead of creating a new one per country
      if (key === "client_country") {
        const existing = criteria.find((c) => c.key === "client_country");
        if (existing) {
          const list = existing.value.split(",").map((s) => s.trim()).filter(Boolean);
          if (list.includes(value.trim())) {
            setFormError("This country is already blocked.");
            return;
          }
          await fetch(`/api/admin/bidding-criteria/${existing.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ value: [...list, value.trim()].join(",") }),
          });
          setValue("");
          await load();
          return;
        }
      }

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
                onChange={(e) => {
                  const newKey = e.target.value;
                  setKey(newKey);
                  setValue("");
                  setFormError(null);
                  const meta = fieldMeta(newKey);
                  if (meta?.type === "string") setOperator("neq");
                  else setOperator(DEFAULT_OPERATOR[newKey] ?? "gte");
                }}
                className={`${selectClass} w-full`}
              >
                {FIELD_OPTIONS.map((f) => (
                  <option key={f.key} value={f.key}>{f.label}</option>
                ))}
              </select>
            </div>

            {!isBoolean && !isString && (
              <div>
                <label className="block text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-1.5">Must be</label>
                <select
                  value={operator}
                  onChange={(e) => setOperator(e.target.value as Operator)}
                  className={`${selectClass} w-28 pr-4`}
                >
                  {OPERATOR_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            )}

            {!isBoolean && (
              <div>
                <label className="block text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-1.5">
                  {isString ? "Country" : "Value"}
                </label>
                <div className="flex items-center gap-1.5">
                  {selectedField?.unit === "$" && (
                    <span className="text-sm text-gray-400 font-medium">$</span>
                  )}
                  {isString ? (
                    <SearchableSelect
                      value={value}
                      onChange={setValue}
                      options={COUNTRY_LIST}
                      placeholder="— Search or select country —"
                      className="w-64"
                    />
                  ) : (
                    <input
                      type="number"
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                      placeholder="e.g. 4"
                      min={0}
                      step={selectedField?.integer ? 1 : "any"}
                      className={`${inputClass} w-28`}
                    />
                  )}
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
        const editIsStr  = editMeta?.type === "string";
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
                  <div className={`w-full ${inputClass} bg-gray-50 text-gray-500 cursor-not-allowed`}>
                    {fieldMeta(editKey)?.label ?? editKey}
                  </div>
                </div>

                {!editIsBool && (
                  <div className="flex gap-3 flex-wrap">
                    {!editIsStr && (
                      <div className="flex-none">
                        <label className="block text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-1.5">Must be</label>
                        <select
                          value={editOperator}
                          onChange={(e) => setEditOperator(e.target.value as Operator)}
                          className={`${selectClass} w-28 pr-4`}
                        >
                          {OPERATOR_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div className="flex-1">
                      <label className="block text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-1.5">
                        {editIsStr ? "Country" : "Value"}
                      </label>
                      <div className="flex items-center gap-1.5">
                        {editMeta?.unit === "$" && <span className="text-sm text-gray-400 font-medium">$</span>}
                        {editIsStr ? (
                          <div className="flex flex-col gap-2 flex-1">
                            <div className="flex flex-wrap gap-1.5 min-h-[28px]">
                              {editValue.split(",").map((s) => s.trim()).filter(Boolean).map((country) => (
                                <span key={country} className="inline-flex items-center gap-1 text-xs bg-teal-50 text-teal-700 border border-teal-200 px-2 py-1 rounded-md font-medium">
                                  {country}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const updated = editValue.split(",").map((s) => s.trim()).filter((s) => s && s !== country);
                                      setEditValue(updated.join(","));
                                    }}
                                    className="text-teal-400 hover:text-rose-500 transition-colors leading-none"
                                  >✕</button>
                                </span>
                              ))}
                              {!editValue.split(",").filter(Boolean).length && (
                                <span className="text-xs text-gray-400 italic">No countries blocked</span>
                              )}
                            </div>
                            <SearchableSelect
                              value={editCountryAdd}
                              onChange={(c) => {
                                if (!c) return;
                                const current = editValue.split(",").map((s) => s.trim()).filter(Boolean);
                                if (!current.includes(c)) setEditValue([...current, c].join(","));
                                setEditCountryAdd("");
                              }}
                              options={COUNTRY_LIST.filter((c) => !editValue.split(",").map((s) => s.trim()).includes(c))}
                              placeholder="+ Search to add country…"
                              className="w-full"
                            />
                          </div>
                        ) : (
                          <input
                            type="number"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            min={0}
                            step={editMeta?.integer ? 1 : "any"}
                            className={`${inputClass} flex-1`}
                          />
                        )}
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
