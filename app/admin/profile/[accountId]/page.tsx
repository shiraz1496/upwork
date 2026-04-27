"use client";

import { use, useEffect, useState } from "react";

type Item = {
  kind: "proposal" | "job" | "alert" | "snapshot";
  at: string;
  title: string;
  url: string | null;
  by: { id: string; name: string } | null;
  subjectId: string;
};

type Payload = {
  account: { id: string; name: string; freelancerId: string };
  items: Item[];
  total: number;
};

const KIND_LABEL: Record<Item["kind"], string> = {
  proposal: "Proposal captured",
  job: "Job viewed",
  alert: "Message",
  snapshot: "Stats snapshot",
};

const KIND_COLOR: Record<Item["kind"], string> = {
  proposal: "bg-blue-100 text-blue-800",
  job: "bg-amber-100 text-amber-800",
  alert: "bg-purple-100 text-purple-800",
  snapshot: "bg-gray-200 text-gray-700",
};

export default function ProfileActivityPage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  const { accountId } = use(params);
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/admin/profile/${accountId}/timeline`, { cache: "no-store" })
      .then((r) => {
        if (r.status === 401) {
          window.location.href = "/admin/login";
          return Promise.reject();
        }
        if (r.status === 404) throw new Error("Account not found");
        return r.json();
      })
      .then(setData)
      .catch((e) => {
        if (e) setError(e instanceof Error ? e.message : "Failed");
      });
  }, [accountId]);

  if (error) {
    return <div className="mx-auto max-w-4xl p-8 text-sm text-red-700">{error}</div>;
  }
  if (!data) {
    return <div className="mx-auto max-w-4xl p-8 text-sm text-gray-500">Loading…</div>;
  }

  return (
    <div className="mx-auto max-w-4xl p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">{data.account.name}</h1>
        <p className="font-mono text-xs text-gray-500">{data.account.freelancerId}</p>
        <p className="mt-1 text-sm text-gray-500">
          {data.total} recorded actions, showing newest 200
        </p>
      </header>

      {data.items.length === 0 ? (
        <div className="rounded border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
          No activity recorded for this profile yet.
        </div>
      ) : (
        <ol className="space-y-2">
          {data.items.map((item, i) => (
            <li
              key={`${item.kind}-${item.subjectId}-${i}`}
              className="flex gap-3 rounded border border-gray-200 p-3 text-sm"
            >
              <div className="w-32 shrink-0 text-xs text-gray-500">
                {new Date(item.at).toLocaleString()}
              </div>
              <span
                className={`h-fit shrink-0 rounded px-2 py-0.5 text-[11px] ${KIND_COLOR[item.kind]}`}
              >
                {KIND_LABEL[item.kind]}
              </span>
              <div className="min-w-0 flex-1">
                {item.url ? (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="truncate text-blue-600 hover:underline"
                  >
                    {item.title}
                  </a>
                ) : (
                  <span className="truncate">{item.title}</span>
                )}
                <div className="text-xs text-gray-500">
                  by{" "}
                  {item.by?.name || (
                    <span className="italic text-gray-400">unattributed</span>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
