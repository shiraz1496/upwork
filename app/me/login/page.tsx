"use client";

import { useState } from "react";
import { Spinner } from "@/components/ui/Spinner";

export default function MeLoginPage() {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/me/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (res.ok) {
        window.location.href = "/me";
        return;
      }
      const body = await res.json().catch(() => ({}));
      setError(
        res.status === 401 ? `Token rejected: ${body.error || "unknown"}` : `HTTP ${res.status}`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-teal-500 text-white flex items-center justify-center text-sm font-bold">
            UT
          </div>
          <span className="text-base font-semibold text-gray-900 tracking-tight">Upwork Tracker</span>
        </div>
        <form
          onSubmit={onSubmit}
          className="bg-white border border-gray-200 rounded-xl p-6 space-y-4 shadow-sm"
        >
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Sign in</h1>
            <p className="mt-1 text-sm text-gray-500">
              Paste your extension token. Your admin gave you the same one you used in the Chrome
              extension popup.
            </p>
          </div>
          {error && (
            <div className="rounded-lg bg-rose-50 border border-rose-100 p-3 text-sm text-rose-700">
              {error}
            </div>
          )}
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium text-gray-700">Extension token</span>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="ut_..."
              required
              autoFocus
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-teal-500 hover:bg-teal-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 transition-colors shadow-sm"
          >
            {busy && <Spinner />}
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
