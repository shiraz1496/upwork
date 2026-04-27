"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Spinner } from "@/components/ui/Spinner";

type Token = {
  id: string;
  label: string | null;
  lastUsedAt: string | null;
  createdAt: string;
};

type Member = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "bidder";
  status: "active" | "inactive";
  createdAt: string;
  tokens: Token[];
  _count: { tokens: number };
};

export function TeamView() {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState<"admin" | "bidder">("bidder");
  const [creating, setCreating] = useState(false);

  const [issuingFor, setIssuingFor] = useState<Member | null>(null);
  const [tokenLabel, setTokenLabel] = useState("");
  const [issuedRaw, setIssuedRaw] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [generating, setGenerating] = useState(false);

  const [revokeTarget, setRevokeTarget] = useState<Token | null>(null);
  const [revoking, setRevoking] = useState(false);

  const loadMembers = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/team", { cache: "no-store" });
      if (res.status === 401) {
        window.location.href = "/admin/login";
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setMembers(data.members);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, []);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  async function createMember(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await fetch("/api/admin/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName, email: newEmail, role: newRole }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setShowCreate(false);
      setNewName("");
      setNewEmail("");
      setNewRole("bidder");
      await loadMembers();
    } catch (e) {
      alert(`Failed: ${e instanceof Error ? e.message : "unknown"}`);
    } finally {
      setCreating(false);
    }
  }

  async function toggleStatus(m: Member) {
    const next = m.status === "active" ? "inactive" : "active";
    const res = await fetch(`/api/admin/team/${m.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    if (!res.ok) return alert(`Failed: HTTP ${res.status}`);
    loadMembers();
  }

  async function issueToken(e: React.FormEvent) {
    e.preventDefault();
    if (!issuingFor) return;
    setGenerating(true);
    try {
      const res = await fetch(`/api/admin/team/${issuingFor.id}/tokens`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: tokenLabel || undefined }),
      });
      if (!res.ok) {
        alert(`Failed: HTTP ${res.status}`);
        return;
      }
      const data = await res.json();
      setIssuedRaw(data.raw);
      setTokenLabel("");
      await loadMembers();
    } finally {
      setGenerating(false);
    }
  }

  async function confirmRevoke() {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      const res = await fetch(`/api/admin/team/tokens/${revokeTarget.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRevokeTarget(null);
      await loadMembers();
    } catch (e) {
      alert(`Failed: ${e instanceof Error ? e.message : "unknown"}`);
    } finally {
      setRevoking(false);
    }
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
            Team Members
            {members && (
              <span className="ml-2 text-gray-400 font-normal">({members.length})</span>
            )}
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">Issue extension tokens, manage status.</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-teal-500 hover:bg-teal-600 text-white text-sm font-medium rounded-lg transition-colors shadow-sm"
        >
          Add member
        </button>
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
          No members yet.
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wider text-gray-500">
              <tr>
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium">Email</th>
                <th className="px-5 py-3 font-medium">Role</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Tokens</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {members.map((m) => (
                <MemberRow
                  key={m.id}
                  member={m}
                  expanded={expandedId === m.id}
                  onToggleExpand={() => setExpandedId(expandedId === m.id ? null : m.id)}
                  onToggleStatus={() => toggleStatus(m)}
                  onIssueToken={() => setIssuingFor(m)}
                  onRevokeToken={setRevokeTarget}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Add member">
        <form onSubmit={createMember} className="space-y-4">
          <LabeledInput label="Name" value={newName} onChange={setNewName} required />
          <LabeledInput label="Email" type="email" value={newEmail} onChange={setNewEmail} required />
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-gray-700">Role</span>
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as "admin" | "bidder")}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-teal-500"
            >
              <option value="bidder">Bidder</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="px-4 py-2 bg-white border border-gray-200 text-gray-700 text-sm rounded-lg hover:bg-gray-50 shadow-sm transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creating}
              className="inline-flex items-center gap-2 px-4 py-2 bg-teal-500 hover:bg-teal-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors shadow-sm"
            >
              {creating && <Spinner />}
              {creating ? "Creating…" : "Create"}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={issuingFor !== null}
        onClose={() => {
          setIssuingFor(null);
          setIssuedRaw(null);
          setCopied(false);
        }}
        title={issuedRaw ? "Copy token now" : `Issue token for ${issuingFor?.name ?? ""}`}
      >
        {issuedRaw ? (
          <div className="space-y-4">
            <div className="rounded-lg bg-amber-50 border border-amber-100 p-3 text-sm text-amber-800">
              This token will <strong>not</strong> be shown again. Copy it now and paste into the extension popup.
            </div>
            <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 font-mono text-xs text-gray-700 break-all">
              {issuedRaw}
            </div>
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(issuedRaw);
                setCopied(true);
              }}
              className="w-full px-4 py-2 bg-teal-500 hover:bg-teal-600 text-white text-sm font-medium rounded-lg transition-colors shadow-sm"
            >
              {copied ? "Copied ✓" : "Copy to clipboard"}
            </button>
            <button
              type="button"
              onClick={() => {
                setIssuingFor(null);
                setIssuedRaw(null);
                setCopied(false);
              }}
              className="w-full px-4 py-2 bg-white border border-gray-200 text-gray-700 text-sm rounded-lg hover:bg-gray-50 shadow-sm transition-colors"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={issueToken} className="space-y-4">
            <LabeledInput
              label="Label (optional)"
              value={tokenLabel}
              onChange={setTokenLabel}
              placeholder="e.g. Alice's MacBook"
            />
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIssuingFor(null)}
                className="px-4 py-2 bg-white border border-gray-200 text-gray-700 text-sm rounded-lg hover:bg-gray-50 shadow-sm transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={generating}
                className="inline-flex items-center gap-2 px-4 py-2 bg-teal-500 hover:bg-teal-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors shadow-sm"
              >
                {generating && <Spinner />}
                {generating ? "Generating…" : "Generate"}
              </button>
            </div>
          </form>
        )}
      </Modal>
      <Modal
        open={revokeTarget !== null}
        onClose={() => { if (!revoking) setRevokeTarget(null); }}
        title="Revoke token"
      >
        <div className="space-y-4">
          <div className="rounded-lg bg-rose-50 border border-rose-100 p-3 text-sm text-rose-800">
            <p className="font-medium mb-1">
              {revokeTarget?.label ? `"${revokeTarget.label}"` : "This token"} will be permanently revoked.
            </p>
            <p className="text-rose-700">
              Any device or dashboard session using it will be signed out immediately. This cannot be undone.
            </p>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setRevokeTarget(null)}
              disabled={revoking}
              className="px-4 py-2 bg-white border border-gray-200 text-gray-700 text-sm rounded-lg hover:bg-gray-50 shadow-sm transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmRevoke}
              disabled={revoking}
              className="inline-flex items-center gap-2 px-4 py-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors shadow-sm"
            >
              {revoking && <Spinner />}
              {revoking ? "Revoking…" : "Revoke token"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function MemberRow({
  member,
  expanded,
  onToggleExpand,
  onToggleStatus,
  onIssueToken,
  onRevokeToken,
}: {
  member: Member;
  expanded: boolean;
  onToggleExpand: () => void;
  onToggleStatus: () => void;
  onIssueToken: () => void;
  onRevokeToken: (token: Token) => void;
}) {
  return (
    <>
      <tr className="hover:bg-gray-50">
        <td className="px-5 py-3 font-medium text-gray-900">{member.name}</td>
        <td className="px-5 py-3 text-gray-600">{member.email}</td>
        <td className="px-5 py-3">
          <span className="rounded-full bg-gray-100 text-gray-700 px-2.5 py-0.5 text-[11px] font-medium">
            {member.role}
          </span>
        </td>
        <td className="px-5 py-3">
          <button
            onClick={onToggleStatus}
            className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
              member.status === "active"
                ? "bg-green-50 text-green-700 border border-green-100 hover:bg-green-100"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {member.status}
          </button>
        </td>
        <td className="px-5 py-3 text-gray-700">{member.tokens.length}</td>
        <td className="px-5 py-3 text-right">
          <button
            onClick={onToggleExpand}
            className="text-sm text-teal-600 hover:text-teal-700 font-medium"
          >
            {expanded ? "Hide" : "Manage"} tokens
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="bg-gray-50/50">
          <td colSpan={6} className="px-5 py-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-medium text-gray-900">Active tokens</h3>
              <button
                onClick={onIssueToken}
                className="px-3 py-1.5 bg-teal-500 hover:bg-teal-600 text-white text-xs font-medium rounded-lg transition-colors shadow-sm"
              >
                Issue new token
              </button>
            </div>
            {member.tokens.length === 0 ? (
              <p className="text-sm text-gray-500">No active tokens.</p>
            ) : (
              <ul className="space-y-2">
                {member.tokens.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-3 text-sm"
                  >
                    <div>
                      <div className="font-medium text-gray-900">
                        {t.label || <span className="text-gray-400 font-normal">(no label)</span>}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        Created {new Date(t.createdAt).toLocaleDateString()} · Last used{" "}
                        {t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString() : "never"}
                      </div>
                    </div>
                    <button
                      onClick={() => onRevokeToken(t)}
                      className="text-xs text-rose-600 hover:text-rose-700 font-medium"
                    >
                      Revoke
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  type = "text",
  required,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-gray-700">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        placeholder={placeholder}
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-teal-500"
      />
    </label>
  );
}

function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
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
          <h3 className="text-base font-semibold text-gray-900">{title}</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
