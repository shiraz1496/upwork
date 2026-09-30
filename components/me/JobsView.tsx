"use client";

import { useState } from "react";
import { ProvenanceBadge } from "@/components/me/ProvenanceBadge";
import type { ProposalSeed } from "@/components/me/ProposalsView";
import { api, btnGhost, btnPrimary, card, input, useLoad } from "@/components/me/api";

type Evaluation = {
  matched: string[];
  failed: string[];
  unknown: string[];
  blockedBy: string | null;
  meetsRequired: boolean | null;
};

type Job = {
  upworkJobId: string;
  title: string;
  url: string | null;
  descriptionSnippet: string | null;
  skills: string[];
  jobType: "hourly" | "fixed" | null;
  budgetMin: number | null;
  budgetMax: number | null;
  experienceLevel: string | null;
  duration: string | null;
  proposalsTier: string | null;
  postedAt: string | null;
  applied: boolean | null;
  client: { country: string | null; rating: number | null; totalSpent: number | null; paymentVerified: boolean | null };
  evaluation: Evaluation;
};

type JobsResponse = {
  status: "ok" | "disabled";
  detail?: string;
  provenance?: string;
  retrievedAt?: string;
  jobs: Job[] | null;
};

type Mode = "best_match" | "most_recent" | "search";

function budgetText(j: Job): string {
  if (j.budgetMin === null && j.budgetMax === null) return j.jobType === "hourly" ? "Hourly · rate not stated" : "Budget not stated";
  const suffix = j.jobType === "hourly" ? "/hr" : "";
  if (j.budgetMin !== null && j.budgetMax !== null) {
    return j.budgetMin === j.budgetMax ? `$${j.budgetMin}${suffix}` : `$${j.budgetMin}–$${j.budgetMax}${suffix}`;
  }
  return j.budgetMin !== null ? `From $${j.budgetMin}${suffix}` : `Up to $${j.budgetMax}${suffix}`;
}

// Plain statement of the admin's required criteria — not a score or a recommendation.
function RequiredSummary({ e }: { e: Evaluation }) {
  if (e.meetsRequired === true) {
    return <span className="inline-flex rounded-full border border-green-200 bg-green-50 px-2.5 py-0.5 text-[11px] font-medium text-green-700">Meets required criteria</span>;
  }
  if (e.meetsRequired === false) {
    return <span className="inline-flex rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 text-[11px] font-medium text-rose-700">{e.blockedBy ? "Blocked title" : "Fails a required criterion"}</span>;
  }
  return <span className="inline-flex rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-[11px] font-medium text-gray-600">Not enough data to check</span>;
}

function Reasons({ label, items, cls }: { label: string; items: string[]; cls: string }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold w-16 shrink-0">{label}</span>
      {items.map((r) => (
        <span key={r} className={`inline-flex rounded-md border px-2 py-0.5 text-[11px] ${cls}`}>{r}</span>
      ))}
    </div>
  );
}

export function JobsView({ onStartProposal, onGoToUpwork }: { onStartProposal: (seed: ProposalSeed) => void; onGoToUpwork: () => void }) {
  const [mode, setMode] = useState<Mode>("best_match");
  const [titleInput, setTitleInput] = useState("");
  const [query, setQuery] = useState<{ mode: Mode; title: string }>({ mode: "best_match", title: "" });
  const [reloadKey, setReloadKey] = useState(0);

  const params = new URLSearchParams({ mode: query.mode });
  if (query.mode === "search" && query.title) params.set("title", query.title);
  const { data, error, errorCode, loading } = useLoad<JobsResponse>(`/api/me/jobs?${params}`, reloadKey);

  function run(next: Mode) {
    setMode(next);
    if (next !== "search") {
      setQuery({ mode: next, title: "" });
      setReloadKey((k) => k + 1);
    }
  }

  // Opening a job is what counts as "reviewed" (recorded in this app, not by watching Upwork).
  function openJob(j: Job) {
    void api("POST", "/api/me/jobs/review", { upworkJobId: j.upworkJobId, jobTitle: j.title });
  }

  const notConnected = errorCode === "not_connected";

  return (
    <section className="mt-6 space-y-4">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Find jobs</h2>
        <p className="text-xs text-gray-400 mt-0.5">
          Jobs come from your own Upwork account. Each one shows which of the team&apos;s bid criteria it meets. You
          apply on Upwork yourself.
        </p>
      </div>

      <div className={`${card} p-4 flex flex-wrap items-center gap-2`}>
        {([["best_match", "Best matches"], ["most_recent", "Most recent"], ["search", "Search"]] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => run(id)}
            aria-pressed={mode === id}
            className={mode === id ? btnPrimary : btnGhost}
          >
            {label}
          </button>
        ))}
        {mode === "search" && (
          <form
            className="flex items-center gap-2 flex-1 min-w-[220px]"
            onSubmit={(e) => {
              e.preventDefault();
              setQuery({ mode: "search", title: titleInput.trim() });
              setReloadKey((k) => k + 1);
            }}
          >
            <input
              className={input}
              placeholder="Words in the job title, e.g. Laravel"
              value={titleInput}
              onChange={(e) => setTitleInput(e.target.value)}
              aria-label="Job title search"
            />
            <button type="submit" className={btnPrimary}>Search</button>
          </form>
        )}
      </div>

      {loading && !data && !error ? (
        <div className="py-6 text-sm text-gray-500">Loading jobs…</div>
      ) : notConnected ? (
        <div className={`${card} p-6 text-sm text-gray-600`}>
          <p>Connect your Upwork account to see jobs here.</p>
          <button className={`${btnPrimary} mt-3`} onClick={onGoToUpwork}>Go to Upwork connection</button>
        </div>
      ) : error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>
      ) : data?.status === "disabled" ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <div className="font-medium">Job search is switched off</div>
          <p className="mt-0.5 text-amber-700">
            {data.detail}. You can still add a proposal by hand from the Proposals tab using a job link.
          </p>
        </div>
      ) : (data?.jobs ?? []).length === 0 ? (
        <div className={`${card} py-16 text-center text-sm text-gray-400`}>No jobs found.</div>
      ) : (
        <>
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <ProvenanceBadge provenance={data?.provenance} />
            {data?.retrievedAt && (
              <span>
                {data.provenance === "MOCK" ? "Made-up test jobs, generated" : "Read from Upwork"} at{" "}
                {new Date(data.retrievedAt).toLocaleTimeString()}
              </span>
            )}
            <span>· shown in Upwork&apos;s order</span>
          </div>
          <ul className="space-y-3">
            {(data?.jobs ?? []).map((j) => (
              <li key={j.upworkJobId} className={`${card} p-5`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-gray-900 break-words">{j.title}</h3>
                    <div className="mt-1 text-xs text-gray-500 flex flex-wrap gap-x-3 gap-y-0.5">
                      <span>{budgetText(j)}</span>
                      {j.experienceLevel && <span className="capitalize">{j.experienceLevel.replace("_", " ")}</span>}
                      {j.proposalsTier && <span>Proposals: {j.proposalsTier}</span>}
                      {j.client.country && <span>{j.client.country}</span>}
                      {j.postedAt && <span>Posted {new Date(j.postedAt).toLocaleDateString()}</span>}
                    </div>
                  </div>
                  <div className="shrink-0 flex flex-col items-end gap-1.5">
                    <RequiredSummary e={j.evaluation} />
                    {j.applied === true && (
                      <span className="inline-flex rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-[11px] font-medium text-blue-700">Already applied</span>
                    )}
                  </div>
                </div>

                {j.descriptionSnippet && <p className="mt-3 text-sm text-gray-600 whitespace-pre-wrap line-clamp-3">{j.descriptionSnippet}</p>}

                {j.skills.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {j.skills.slice(0, 10).map((s) => (
                      <span key={s} className="rounded-md bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600">{s}</span>
                    ))}
                  </div>
                )}

                <div className="mt-4 space-y-1.5">
                  <Reasons label="Matched" items={j.evaluation.matched} cls="border-green-200 bg-green-50 text-green-700" />
                  <Reasons label="Failed" items={j.evaluation.failed} cls="border-rose-200 bg-rose-50 text-rose-700" />
                  <Reasons label="Unknown" items={j.evaluation.unknown} cls="border-gray-200 bg-gray-50 text-gray-500" />
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {j.url && (
                    <a className={btnGhost} href={j.url} target="_blank" rel="noopener noreferrer" onClick={() => openJob(j)}>
                      Open on Upwork
                    </a>
                  )}
                  {j.url && j.applied !== true && (
                    <button
                      className={btnPrimary}
                      onClick={() => {
                        openJob(j);
                        onStartProposal({ upworkJobId: j.upworkJobId, jobUrl: j.url!, jobTitle: j.title });
                      }}
                    >
                      Start proposal
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
