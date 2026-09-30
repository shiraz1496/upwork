"use client";

import { useState } from "react";
import { Spinner } from "@/components/ui/Spinner";
import { api, btnDanger, btnGhost, btnPrimary, card, useLoad } from "@/components/me/api";

type Status = {
  integration: "enabled" | "mock" | "disabled";
  detail?: string;
  status: "disconnected" | "connected" | "expired" | "revoked" | "error";
  accountName: string | null;
  connectedAt: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
};

type Part = { status: string; detail?: string; stored?: number | boolean; linked?: number; needManualLink?: number; provenance?: string };
type RefreshResult = { status: "ok" | "disabled"; detail?: string; profile?: Part; proposals?: Part; responses?: Part };

// Messages for the ?upwork=… code the OAuth callback redirects back with.
const CALLBACK_MESSAGES: Record<string, { ok: boolean; text: string }> = {
  connected: { ok: true, text: "Your Upwork account is connected." },
  denied: { ok: false, text: "You declined access on Upwork. Nothing was connected." },
  disabled: { ok: false, text: "The Upwork connection is switched off for now." },
  state_mismatch: { ok: false, text: "That sign-in link was already used or expired. Please connect again." },
  account_in_use: { ok: false, text: "This Upwork account is already connected by another team member." },
  no_freelancer_account: { ok: false, text: "That Upwork login has no freelancer account." },
  invalid: { ok: false, text: "Upwork did not return a valid response. Please connect again." },
};

const STATUS_STYLE: Record<Status["status"], { label: string; cls: string }> = {
  connected: { label: "Connected", cls: "bg-green-50 text-green-700 border-green-200" },
  disconnected: { label: "Not connected", cls: "bg-gray-50 text-gray-600 border-gray-200" },
  expired: { label: "Expired — reconnect", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  revoked: { label: "Access revoked — reconnect", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  error: { label: "Error", cls: "bg-rose-50 text-rose-700 border-rose-200" },
};

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "never");

export function UpworkView({ callbackCode, onChanged }: { callbackCode: string | null; onChanged: () => void }) {
  const [reloadKey, setReloadKey] = useState(0);
  const { data: status, error, loading } = useLoad<Status>("/api/me/upwork/status", reloadKey);
  const [busy, setBusy] = useState<"connect" | "refresh" | "disconnect" | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    callbackCode ? (CALLBACK_MESSAGES[callbackCode] ?? { ok: false, text: "Connecting to Upwork failed. Please try again." }) : null,
  );
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  async function connect() {
    setBusy("connect");
    setMessage(null);
    const res = await api<{ authorizeUrl: string }>("POST", "/api/me/upwork/connect");
    if (res.ok) {
      // Upwork's own consent page. The bidder signs in to THEIR account and approves there.
      window.location.href = res.data.authorizeUrl;
      return;
    }
    setBusy(null);
    setMessage({ ok: false, text: res.error });
  }

  async function refresh() {
    setBusy("refresh");
    setMessage(null);
    const res = await api<RefreshResult>("POST", "/api/me/upwork/refresh");
    setBusy(null);
    if (!res.ok) {
      setMessage({ ok: false, text: res.error });
    } else if (res.data.status === "disabled") {
      setMessage({ ok: false, text: res.data.detail ?? "The Upwork connection is switched off." });
    } else {
      const parts = [res.data.profile, res.data.proposals, res.data.responses];
      const failed = parts.find((p) => p?.status === "error");
      const r = res.data.responses;
      if (failed) {
        // Some of it may have worked; say plainly that not all of it did.
        setMessage({ ok: false, text: `Not everything could be refreshed: ${failed.detail ?? "Upwork returned an error"}.` });
      } else {
        const replies =
          r?.provenance === "MOCK"
            ? "Test mode: nothing was saved."
            : `${r?.stored ?? 0} new client repl${r?.stored === 1 ? "y" : "ies"}${r?.needManualLink ? `, ${r.needManualLink} need linking to a proposal` : ""}.`;
        setMessage({ ok: true, text: `Refreshed. ${replies}` });
      }
      onChanged();
    }
    setReloadKey((k) => k + 1);
  }

  async function disconnect() {
    setBusy("disconnect");
    const res = await api("POST", "/api/me/upwork/disconnect");
    setBusy(null);
    setConfirmDisconnect(false);
    if (!res.ok) return setMessage({ ok: false, text: res.error });
    setMessage({ ok: true, text: "Upwork is disconnected. Your saved proposals are still here." });
    setReloadKey((k) => k + 1);
    onChanged();
  }

  if (loading && !status) return <div className="py-6 text-sm text-gray-500">Loading…</div>;
  if (error || !status) {
    return <div className="mt-6 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error ?? "Could not load the connection status."}</div>;
  }

  const disabled = status.integration === "disabled";
  const connected = status.status === "connected";
  const needsReconnect = status.status === "expired" || status.status === "revoked" || status.status === "error";
  // Details of a past connection are not shown once it is disconnected.
  const hasConnection = connected || needsReconnect;
  const style = STATUS_STYLE[status.status];

  return (
    <section className="mt-6 space-y-4 max-w-3xl">
      {message && (
        <div
          role="status"
          className={`rounded-xl border px-4 py-2.5 text-sm ${message.ok ? "border-green-200 bg-green-50 text-green-800" : "border-rose-200 bg-rose-50 text-rose-700"}`}
        >
          {message.text}
        </div>
      )}

      {disabled && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <div className="font-medium">Upwork connection is switched off</div>
          <p className="mt-0.5 text-amber-700">
            {status.detail}. You can still track your proposals here by hand; jobs and client replies from Upwork will
            appear once it is switched on.
          </p>
        </div>
      )}
      {status.integration === "mock" && (
        <div className="rounded-xl border border-purple-200 bg-purple-50 px-4 py-2.5 text-sm text-purple-800">
          Test mode: this is using made-up data, not Upwork.
        </div>
      )}

      <div className={`${card} p-6`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Your Upwork account</h2>
            <p className="mt-1 text-sm text-gray-500">
              Connect your own Upwork account. You sign in on Upwork and approve access there — this app never sees
              your password, and it never submits anything on your behalf.
            </p>
          </div>
          <span className={`shrink-0 inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${style.cls}`}>
            {style.label}
          </span>
        </div>

        <dl className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
          <div>
            <dt className="text-[11px] uppercase tracking-wider text-gray-400 font-medium">Account</dt>
            <dd className="mt-0.5 text-gray-900">{(hasConnection && status.accountName) || "—"}</dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wider text-gray-400 font-medium">Connected</dt>
            <dd className="mt-0.5 text-gray-900">{hasConnection ? when(status.connectedAt) : "—"}</dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wider text-gray-400 font-medium">Last refreshed</dt>
            <dd className="mt-0.5 text-gray-900">{hasConnection ? when(status.lastSyncedAt) : "—"}</dd>
          </div>
        </dl>

        {status.lastError && (
          <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{status.lastError}</div>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-2">
          {!connected && (
            <button className={btnPrimary} onClick={connect} disabled={disabled || busy !== null}>
              {busy === "connect" && <Spinner />}
              {needsReconnect ? "Reconnect Upwork" : "Connect Upwork"}
            </button>
          )}
          {connected && (
            <button className={btnPrimary} onClick={refresh} disabled={disabled || busy !== null}>
              {busy === "refresh" && <Spinner />}
              {busy === "refresh" ? "Refreshing…" : "Refresh activity"}
            </button>
          )}
          {(connected || needsReconnect) && !confirmDisconnect && (
            <button className={btnGhost} onClick={() => setConfirmDisconnect(true)} disabled={busy !== null}>
              Disconnect
            </button>
          )}
        </div>

        {confirmDisconnect && (
          <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm">
            <p className="text-rose-800">
              Disconnect your Upwork account? This removes the access this app holds. Your saved proposals stay,
              and you can connect again at any time.
            </p>
            <div className="mt-3 flex gap-2">
              <button className={btnDanger} onClick={disconnect} disabled={busy !== null}>
                {busy === "disconnect" && <Spinner />}
                Yes, disconnect
              </button>
              <button className={btnGhost} onClick={() => setConfirmDisconnect(false)} disabled={busy !== null}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {connected && (
          <p className="mt-4 text-xs text-gray-400">
            Refresh reads your profile, Connects balance and client replies from Upwork when you ask. Nothing runs in
            the background.
          </p>
        )}
      </div>
    </section>
  );
}
