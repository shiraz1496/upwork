"use client";

import { useMemo } from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  AreaChart,
  Area,
} from "recharts";
import type { AccountData, OverviewRange } from "@/lib/overview-types";
import {
  computeAggregated,
  computeDeltas,
  computeTimeSeriesData,
  computeFunnelData,
  computeSnapshotTimeline,
  fmt,
  type TimelineEntry,
} from "@/lib/overview-aggregation";

const COLORS = {
  teal: "#14b8a6",
  blue: "#3b82f6",
  purple: "#8b5cf6",
  amber: "#f59e0b",
  rose: "#f43f5e",
  green: "#22c55e",
  cyan: "#06b6d4",
};

const CHART_TOOLTIP_STYLE = {
  contentStyle: {
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: 8,
    boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1)",
  },
  labelStyle: { color: "#111827" },
  itemStyle: { color: "#374151" },
};
const CHART_GRID_COLOR = "#f3f4f6";
const CHART_AXIS_COLOR = "#9ca3af";
const CHART_TICK_COLOR = "#9ca3af";

const iconProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};
const IconArrowUp = () => (
  <svg {...iconProps} className="w-3 h-3 shrink-0">
    <polyline points="18 15 12 9 6 15" />
  </svg>
);
const IconArrowDown = () => (
  <svg {...iconProps} className="w-3 h-3 shrink-0">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

export type ActivityComparison = {
  cur: { sent: number; viewed: number; interviewed: number; hired: number };
  prev: { sent: number; viewed: number; interviewed: number; hired: number };
  prevDate: string;
} | null;

export type OverviewPanelProps = {
  accounts: AccountData[];
  range: OverviewRange;
  onRangeChange: (r: OverviewRange) => void;
  showAccountComparison?: boolean;
  activityComparison?: ActivityComparison;
  isLoadingComparison?: boolean;
};

function pct(cur: number, prev: number): number | null {
  return prev === 0 ? null : Math.round(((cur - prev) / prev) * 100);
}

export function OverviewPanel({
  accounts,
  range,
  onRangeChange,
  showAccountComparison = false,
  activityComparison,
  isLoadingComparison = false,
}: OverviewPanelProps) {
  const aggregated = useMemo(() => computeAggregated(accounts, range), [accounts, range]);
  const deltas = useMemo(() => computeDeltas(accounts, range), [accounts, range]);
  const timeSeriesData = useMemo(() => computeTimeSeriesData(accounts, range), [accounts, range]);
  const funnelData = useMemo(() => computeFunnelData(aggregated), [aggregated]);
  const timeline = useMemo(() => computeSnapshotTimeline(accounts, range), [accounts, range]);

  const rangeLabel = range === "7d" ? "7" : range === "30d" ? "30" : "90";

  const cmp = activityComparison;

  return (
    <div className="py-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Proposal performance</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {aggregated.snapshotsInRange.length} snapshot
            {aggregated.snapshotsInRange.length !== 1 ? "s" : ""} captured in this range
          </p>
        </div>
        <select
          value={range}
          onChange={(e) => onRangeChange(e.target.value as OverviewRange)}
          className="text-xs border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-teal-500 cursor-pointer shadow-sm"
        >
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
        </select>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard
          label="Proposals Sent"
          value={fmt(aggregated.sent)}
          color={COLORS.blue}
          delta={cmp ? pct(cmp.cur.sent, cmp.prev.sent) : null}
          prevValue={cmp?.prev.sent}
          prevDate={cmp?.prevDate}
          isLoading={isLoadingComparison}
        />
        <StatCard
          label="Viewed"
          value={fmt(aggregated.viewed)}
          sub={`${aggregated.viewRate}% view rate`}
          color={COLORS.cyan}
          delta={cmp ? pct(cmp.cur.viewed, cmp.prev.viewed) : null}
          prevValue={cmp?.prev.viewed}
          prevDate={cmp?.prevDate}
          isLoading={isLoadingComparison}
        />
        <StatCard
          label="Interviewed"
          value={fmt(aggregated.interviewed)}
          sub={`${aggregated.interviewRate}% of sent`}
          color={COLORS.purple}
          delta={cmp ? pct(cmp.cur.interviewed, cmp.prev.interviewed) : null}
          prevValue={cmp?.prev.interviewed}
          prevDate={cmp?.prevDate}
          isLoading={isLoadingComparison}
        />
        <StatCard
          label="Hired"
          value={fmt(aggregated.hired)}
          sub={`${aggregated.hireRate}% hire rate`}
          color={COLORS.green}
          delta={cmp ? pct(cmp.cur.hired, cmp.prev.hired) : null}
          prevValue={cmp?.prev.hired}
          prevDate={cmp?.prevDate}
          isLoading={isLoadingComparison}
        />
        {aggregated.jss !== null && (
          <StatCard
            label="JSS"
            value={`${aggregated.jss}%`}
            color={
              aggregated.jss >= 90 ? COLORS.green : aggregated.jss >= 70 ? COLORS.amber : COLORS.rose
            }
          />
        )}
        {aggregated.connectsBalance !== null && aggregated.connectsBalance > 0 && (
          <StatCard
            label="Connects"
            value={fmt(aggregated.connectsBalance)}
            color={COLORS.amber}
          />
        )}
        <StatCard
          label="Data Points"
          value={aggregated.snapshotsInRange.length}
          sub={`in last ${rangeLabel} days`}
        />
      </div>

      {/* ── Snapshot timeline strip ──────────────────────────────────────── */}
      {timeline.length >= 1 && <SnapshotTimeline entries={timeline} range={range} />}

      <SectionTitle>Conversion Pipeline</SectionTitle>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Sent → Viewed", value: `${aggregated.viewRate}%`, color: COLORS.cyan },
          {
            label: "Viewed → Interview",
            value: `${aggregated.viewToInterview}%`,
            color: COLORS.purple,
          },
          {
            label: "Interview → Hired",
            value: `${aggregated.interviewToHire}%`,
            color: COLORS.green,
          },
          { label: "Overall Hire Rate", value: `${aggregated.hireRate}%`, color: COLORS.teal },
        ].map((item) => (
          <div
            key={item.label}
            className="bg-white border border-gray-200 rounded-xl p-4 text-center shadow-sm"
          >
            <div className="text-xs text-gray-500 mb-1">{item.label}</div>
            <div className="text-xl font-bold" style={{ color: item.color }}>
              {item.value}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6">
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-600 mb-4">Proposal Funnel</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={funnelData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} />
              <XAxis
                type="number"
                stroke={CHART_AXIS_COLOR}
                tick={{ fill: CHART_TICK_COLOR, fontSize: 12 }}
              />
              <YAxis
                type="category"
                dataKey="stage"
                stroke={CHART_AXIS_COLOR}
                tick={{ fill: "#374151", fontSize: 13 }}
                width={90}
              />
              <Tooltip {...CHART_TOOLTIP_STYLE} />
              <Bar dataKey="total" name="Count" fill={COLORS.teal} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <SectionTitle>Trends Over Time</SectionTitle>
      {timeSeriesData.length <= 1 ? (
        <div className="bg-white border border-dashed border-gray-200 rounded-xl p-8 text-center">
          <svg
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
            strokeLinecap="round" strokeLinejoin="round"
            className="w-8 h-8 text-gray-300 mx-auto mb-3"
          >
            <path d="M3 3v18h18" />
            <path d="M7 15l4-8 4 6 4-10" />
          </svg>
          <p className="text-sm font-medium text-gray-400">Not enough data yet</p>
          <p className="text-xs text-gray-300 mt-1">
            Capture another snapshot to start seeing trends
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-600 mb-4">Proposals Over Time</h3>
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={timeSeriesData}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} />
                <XAxis
                  dataKey="date"
                  stroke={CHART_AXIS_COLOR}
                  tick={{ fill: CHART_TICK_COLOR, fontSize: 11 }}
                />
                <YAxis stroke={CHART_AXIS_COLOR} tick={{ fill: CHART_TICK_COLOR, fontSize: 12 }} />
                <Tooltip {...CHART_TOOLTIP_STYLE} />
                <Legend />
                <Area type="monotone" dataKey="sent" name="Sent" stroke={COLORS.blue} fill={COLORS.blue} fillOpacity={0.08} />
                <Area type="monotone" dataKey="viewed" name="Viewed" stroke={COLORS.cyan} fill={COLORS.cyan} fillOpacity={0.08} />
                <Area type="monotone" dataKey="interviewed" name="Interviewed" stroke={COLORS.purple} fill={COLORS.purple} fillOpacity={0.08} />
                <Area type="monotone" dataKey="hired" name="Hired" stroke={COLORS.green} fill={COLORS.green} fillOpacity={0.08} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-600 mb-4">Conversion Rates Over Time</h3>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={timeSeriesData}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} />
                <XAxis dataKey="date" stroke={CHART_AXIS_COLOR} tick={{ fill: CHART_TICK_COLOR, fontSize: 11 }} />
                <YAxis stroke={CHART_AXIS_COLOR} tick={{ fill: CHART_TICK_COLOR, fontSize: 12 }} unit="%" />
                <Tooltip {...CHART_TOOLTIP_STYLE} />
                <Legend />
                <Line type="monotone" dataKey="viewRate" name="View Rate" stroke={COLORS.cyan} strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="hireRate" name="Hire Rate" stroke={COLORS.green} strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* {timeSeriesData.some((d) => d.jss !== null) && (
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-gray-600 mb-4">JSS Trend</h3>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={timeSeriesData.filter((d) => d.jss !== null)}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} />
                  <XAxis dataKey="date" stroke={CHART_AXIS_COLOR} tick={{ fill: CHART_TICK_COLOR, fontSize: 11 }} />
                  <YAxis stroke={CHART_AXIS_COLOR} tick={{ fill: CHART_TICK_COLOR, fontSize: 12 }} domain={[0, 100]} unit="%" />
                  <Tooltip {...CHART_TOOLTIP_STYLE} />
                  <Line type="monotone" dataKey="jss" name="JSS" stroke={COLORS.green} strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )} */}
        </div>
      )}

      {showAccountComparison && accounts.length > 1 && (
        <>
          <SectionTitle>Per-Account Comparison</SectionTitle>
          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
            <ResponsiveContainer width="100%" height={Math.max(200, accounts.length * 60)}>
              <BarChart
                data={accounts.map((a) => ({
                  name: a.name,
                  sent: a.latestSnapshot?.funnel.sent ?? 0,
                  viewed: a.latestSnapshot?.funnel.viewed ?? 0,
                  interviewed: a.latestSnapshot?.funnel.interviewed ?? 0,
                  hired: a.latestSnapshot?.funnel.hired ?? 0,
                }))}
                layout="vertical"
              >
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} />
                <XAxis
                  type="number"
                  stroke={CHART_AXIS_COLOR}
                  tick={{ fill: CHART_TICK_COLOR, fontSize: 12 }}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  stroke={CHART_AXIS_COLOR}
                  tick={{ fill: "#374151", fontSize: 13 }}
                  width={120}
                />
                <Tooltip {...CHART_TOOLTIP_STYLE} />
                <Legend />
                <Bar dataKey="sent" name="Sent" fill={COLORS.blue} />
                <Bar dataKey="viewed" name="Viewed" fill={COLORS.cyan} />
                <Bar dataKey="interviewed" name="Interviewed" fill={COLORS.purple} />
                <Bar dataKey="hired" name="Hired" fill={COLORS.green} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
}


function StatCard({
  label,
  value,
  sub,
  color,
  delta,
  prevValue,
  prevDate,
  isLoading = false,
}: {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
  delta?: number | null;
  prevValue?: number;
  prevDate?: string;
  isLoading?: boolean;
}) {
  const up = delta != null && delta > 0;
  const down = delta != null && delta < 0;
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 flex flex-col gap-2 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-gray-500 uppercase tracking-wider font-medium">{label}</span>
        {isLoading ? (
          <div className="h-4 w-10 rounded bg-gray-200 animate-pulse" />
        ) : delta != null ? (
          <span
            className={`inline-flex items-center gap-0.5 text-[11px] font-medium px-1.5 py-0.5 rounded ${
              up
                ? "bg-green-50 text-green-700"
                : down
                  ? "bg-rose-50 text-rose-700"
                  : "bg-gray-50 text-gray-500"
            }`}
          >
            {up && <IconArrowUp />}
            {down && <IconArrowDown />}
            {Math.abs(delta)}%
          </span>
        ) : null}
      </div>
      <span
        className="text-2xl font-semibold tracking-tight"
        style={{ color: color || "#111827" }}
      >
        {value}
      </span>
      {isLoading ? (
        <div className="h-3 w-28 rounded bg-gray-200 animate-pulse" />
      ) : prevValue !== undefined && prevDate !== undefined ? (
        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-gray-400">Previously</span>
          <span className="font-semibold text-gray-600">{fmt(prevValue)}</span>
          <span className="text-gray-300">·</span>
          <span className="text-gray-400">{prevDate} snapshot</span>
        </div>
      ) : null}
      {sub && <span className="text-xs text-gray-400">{sub}</span>}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mt-8 mb-4">
      {children}
    </h2>
  );
}

// ─── Snapshot Timeline Strip ─────────────────────────────────────────────────

const SNAP_BARS = [
  { key: "sent"        as const, color: COLORS.blue,   label: "Sent"        },
  { key: "viewed"      as const, color: COLORS.cyan,   label: "Viewed"      },
  { key: "interviewed" as const, color: COLORS.purple, label: "Interviewed" },
  { key: "hired"       as const, color: COLORS.green,  label: "Hired"       },
];

function SnapshotTimeline({ entries, range }: { entries: TimelineEntry[]; range: OverviewRange }) {
  if (entries.length === 0) return null;

  const globalMax = Math.max(
    ...entries.flatMap((e) => [e.sent, e.viewed, e.interviewed, e.hired]),
    1,
  );

  const rangeLabel = range === "7d" ? "7d" : range === "30d" ? "30d" : "90d";

  return (
    <div className="mt-5 mb-1">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Snapshot history</h2>
        <div className="flex items-center gap-3 text-[10px] text-gray-400">
          {SNAP_BARS.map(({ key, color, label }) => (
            <span key={key} className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm inline-block" style={{ background: color }} />
              {label}
            </span>
          ))}
          <span className="text-gray-300">·</span>
          <span>{entries.length} snapshots · {rangeLabel} window each</span>
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-2" style={{ scrollbarWidth: "thin" }}>
        {entries.map((entry, i) => {
          const prevSent = i > 0 ? entries[i - 1].sent : null;
          const trend = prevSent === null ? null : entry.sent - prevSent;
          const dayLabel = new Date(entry.capturedAt).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }).toUpperCase();

          const vrHigh = entry.viewRate >= 50;
          const vrMid  = entry.viewRate >= 25;
          const vrColor = vrHigh ? "#0d9488" : vrMid ? "#d97706" : "#e11d48";

          return (
            <div
              key={entry.capturedAt}
              className={`group flex-shrink-0 rounded-xl border flex flex-col gap-2.5 p-3 w-[116px] transition-all duration-150 ${
                entry.isLatest
                  ? "border-teal-300 bg-gradient-to-b from-teal-50 to-white shadow-sm shadow-teal-100/60"
                  : "border-gray-200 bg-white shadow-sm hover:shadow-md hover:shadow-gray-100/80"
              }`}
            >
              {/* Day + date row */}
              <div className="flex items-start justify-between">
                <div className="flex flex-col gap-0">
                  <span className={`text-[9px] font-bold tracking-widest ${entry.isLatest ? "text-teal-400" : "text-gray-300"}`}>
                    {dayLabel}
                  </span>
                  <span className={`text-[12px] font-bold leading-tight ${entry.isLatest ? "text-teal-700" : "text-gray-700"}`}>
                    {entry.date}
                  </span>
                </div>
                {entry.isLatest && (
                  <span className="text-[8px] font-bold uppercase tracking-wide bg-teal-500 text-white px-1.5 py-0.5 rounded-full leading-none mt-0.5">
                    Now
                  </span>
                )}
              </div>

              {/* Bar chart */}
              <div className="flex items-end gap-[3px] h-12 px-0.5">
                {SNAP_BARS.map(({ key, color }) => {
                  const val = entry[key as keyof TimelineEntry] as number;
                  const barPct = Math.max((val / globalMax) * 100, val > 0 ? 6 : 0);
                  return (
                    <div key={key} className="flex-1 flex flex-col justify-end h-full relative">
                      {val > 0 && (
                        <span
                          className="absolute left-0 right-0 text-center text-[8px] font-semibold leading-none opacity-0 group-hover:opacity-100 transition-opacity duration-150"
                          style={{ bottom: `calc(${barPct}% + 2px)`, color }}
                        >
                          {val}
                        </span>
                      )}
                      <div
                        className="w-full rounded-t-[3px]"
                        style={{ height: `${barPct}%`, background: color, opacity: 0.7 }}
                      />
                    </div>
                  );
                })}
              </div>

              {/* Divider */}
              <div className={`h-px ${entry.isLatest ? "bg-teal-100" : "bg-gray-100"}`} />

              {/* Sent + trend */}
              <div className="flex items-center justify-between">
                <div className="flex items-baseline gap-1">
                  <span className={`text-[22px] font-bold leading-none ${entry.isLatest ? "text-teal-700" : "text-gray-800"}`}>
                    {entry.sent}
                  </span>
                  <span className="text-[9px] text-gray-400">sent</span>
                </div>
                {trend !== null && trend !== 0 && (
                  <span className={`text-[10px] font-semibold flex items-center gap-0.5 ${trend > 0 ? "text-emerald-500" : "text-rose-400"}`}>
                    {trend > 0 ? "↑" : "↓"}{Math.abs(trend)}
                  </span>
                )}
              </div>

              {/* View rate */}
              <span className="text-[10px] font-medium" style={{ color: vrColor }}>
                {entry.viewRate}% viewed
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
