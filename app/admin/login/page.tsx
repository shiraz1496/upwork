"use client";

import { useState } from "react";
import { Spinner } from "@/components/ui/Spinner";

export default function AdminLoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        window.location.href = "/";
        return;
      }
      if (res.status === 401) setError("Wrong password.");
      else setError(`Login failed (HTTP ${res.status}).`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4 rounded border border-gray-200 p-6">
        <div>
          <h1 className="text-xl font-semibold">Admin login</h1>
          <p className="mt-1 text-sm text-gray-500">Enter the admin password to continue.</p>
        </div>
        {error && <div className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-gray-700">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoFocus
            className="w-full rounded border border-gray-300 px-3 py-2"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="w-full inline-flex items-center justify-center gap-2 rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy && <Spinner />}
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
