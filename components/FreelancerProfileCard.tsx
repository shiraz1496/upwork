"use client";

import { useState } from "react";
import type { FreelancerProfileData } from "@/lib/overview-types";

export function FreelancerProfileCard({
  profile,
  accountName,
}: {
  profile: FreelancerProfileData | null;
  accountName: string;
}) {
  const [expanded, setExpanded] = useState(false);

  if (!profile) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-white p-6 text-sm text-gray-500">
        No freelancer profile data captured yet for{" "}
        <span className="font-medium text-gray-700">{accountName}</span>. Visit the
        Upwork freelancer profile page with the extension installed to populate this section.
      </div>
    );
  }

  const skills = profile.skills ?? [];

  const stats: { label: string; value: string }[] = [];
  if (profile.hourlyRate) stats.push({ label: "Hourly rate", value: profile.hourlyRate });
  if (profile.totalEarnings)
    stats.push({
      label: "Total earnings",
      value: profile.totalEarnings.startsWith("$") ? profile.totalEarnings : `$${profile.totalEarnings}`,
    });
  if (profile.totalJobs != null) stats.push({ label: "Total jobs", value: profile.totalJobs.toLocaleString() });
  if (profile.totalHours != null) stats.push({ label: "Total hours", value: profile.totalHours.toLocaleString() });

  const capturedAtLabel = new Date(profile.capturedAt).toLocaleString();

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      {/* Banner */}
      <div className="h-20 bg-gradient-to-r from-teal-50 via-emerald-50 to-cyan-50 border-b border-gray-100" />

      {/* Header */}
      <div className="px-6 -mt-12">
        <div className="flex items-end gap-5">
          {profile.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.photoUrl}
              alt={accountName}
              className="w-24 h-24 rounded-full object-cover ring-4 ring-white shadow-md shrink-0 bg-gray-100"
            />
          ) : (
            <div className="w-24 h-24 rounded-full bg-gray-100 ring-4 ring-white shadow-md grid place-items-center text-gray-400 text-3xl font-semibold shrink-0">
              {accountName.slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="flex-1 min-w-0 pb-1">
            <h3 className="text-xl font-semibold text-gray-900 truncate">{accountName}</h3>
            {profile.title && (
              <p className="text-sm text-gray-700 mt-1 line-clamp-2">{profile.title}</p>
            )}
            {profile.location && (
              <p className="text-xs text-gray-500 mt-1.5">{profile.location}</p>
            )}
          </div>
          <div className="text-right text-[11px] text-gray-400 whitespace-nowrap pb-1 hidden sm:block">
            Captured {capturedAtLabel}
            {profile.capturedBy && (
              <div className="text-gray-500">by {profile.capturedBy.name}</div>
            )}
          </div>
        </div>
      </div>

      <div className="p-6 space-y-7">
        {/* Stats */}
        {stats.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-gray-100 rounded-xl border border-gray-100 overflow-hidden">
            {stats.map((s) => (
              <div key={s.label} className="bg-white p-4">
                <div className="text-[11px] uppercase tracking-wider text-gray-500">{s.label}</div>
                <div className="text-base font-semibold text-gray-900 mt-1">{s.value}</div>
              </div>
            ))}
          </div>
        )}

        {/* Overview */}
        {profile.overview && (
          <Section title="Overview">
            <p className={`text-sm text-gray-700 whitespace-pre-wrap leading-relaxed ${expanded ? "" : "line-clamp-6"}`}>
              {profile.overview}
            </p>
            {profile.overview.length > 600 && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="text-xs text-teal-600 hover:text-teal-700 font-medium mt-2"
              >
                {expanded ? "Show less" : "Show more"}
              </button>
            )}
          </Section>
        )}

        {/* Skills */}
        {skills.length > 0 && (
          <Section title={`Skills (${skills.length})`}>
            <div className="flex flex-wrap gap-1.5">
              {skills.map((s, i) => (
                <span
                  key={`${s}-${i}`}
                  className="rounded-full bg-gray-100 text-gray-700 text-xs px-2.5 py-1 border border-gray-200"
                >
                  {s}
                </span>
              ))}
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h4 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-2">{title}</h4>
      {children}
    </section>
  );
}
