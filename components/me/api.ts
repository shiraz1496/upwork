"use client";

import { useEffect, useState } from "react";

// errorCode is the API's machine-readable code (e.g. "not_connected"); error is the text to show.
export type LoadState<T> = { data: T | null; error: string | null; errorCode: string | null; loading: boolean };

function errorText(body: unknown, status: number): string {
  const b = body as { detail?: string; error?: string } | null;
  return b?.detail || b?.error || `Request failed (HTTP ${status})`;
}

// GET a developer endpoint. Re-runs when `url` or `reloadKey` changes; 401 → login page.
export function useLoad<T>(url: string | null, reloadKey = 0): LoadState<T> {
  const [state, setState] = useState<LoadState<T>>({ data: null, error: null, errorCode: null, loading: true });
  useEffect(() => {
    if (!url) return;
    let ignore = false;
    fetch(url, { cache: "no-store" })
      .then(async (res) => {
        if (res.status === 401) {
          window.location.href = "/me/login";
          return;
        }
        const body = await res.json().catch(() => null);
        if (ignore) return;
        setState(
          res.ok
            ? { data: body as T, error: null, errorCode: null, loading: false }
            : {
                data: null,
                error: errorText(body, res.status),
                errorCode: (body as { error?: string } | null)?.error ?? null,
                loading: false,
              },
        );
      })
      .catch((e: unknown) => {
        if (!ignore) setState({ data: null, error: e instanceof Error ? e.message : "Network error", errorCode: null, loading: false });
      });
    return () => {
      ignore = true;
    };
  }, [url, reloadKey]);
  return state;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

// POST / PATCH / DELETE a developer endpoint.
export async function api<T = unknown>(method: string, url: string, body?: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) {
      window.location.href = "/me/login";
      return { ok: false, status: 401, error: "Signed out" };
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, status: res.status, error: errorText(data, res.status) };
    return { ok: true, data: data as T };
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : "Network error" };
  }
}

export const card = "bg-white border border-gray-200 rounded-xl shadow-sm";
export const btnPrimary =
  "inline-flex items-center justify-center gap-2 px-3 py-1.5 bg-teal-500 hover:bg-teal-600 text-white text-xs font-medium rounded-lg transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed";
export const btnGhost =
  "inline-flex items-center justify-center gap-2 px-3 py-1.5 border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 text-xs font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
export const btnDanger =
  "inline-flex items-center justify-center gap-2 px-3 py-1.5 border border-rose-200 bg-white hover:bg-rose-50 text-rose-600 text-xs font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
export const input =
  "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-teal-500";
