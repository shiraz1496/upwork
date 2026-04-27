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
  fmt,
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

export type OverviewPanelProps = {
  accounts: AccountData[];
  range: OverviewRange;
  onRangeChange: (r: OverviewRange) => void;
  showAccountComparison?: boolean;
};

export function OverviewPanel({
  accounts,
  range,
  onRangeChange,
  showAccountComparison = false,
}: OverviewPanelProps) {
  const aggregated = useMemo(() => computeAggregated(accounts, range), [accounts, range]);
  const deltas = useMemo(() => computeDeltas(accounts, range), [accounts, range]);
  const timeSeriesData = useMemo(() => computeTimeSeriesData(accounts, range), [accounts, range]);
  const funnelData = useMemo(() => computeFunnelData(aggregated), [aggregated]);

  const rangeLabel = range === "7d" ? "7" : range === "30d" ? "30" : "90";

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
          delta={deltas?.sent}
        />
        <StatCard
          label="Viewed"
          value={fmt(aggregated.viewed)}
          sub={`${aggregated.viewRate}% view rate`}
          color={COLORS.cyan}
          delta={deltas?.viewed}
        />
        <StatCard
          label="Interviewed"
          value={fmt(aggregated.interviewed)}
          sub={`${aggregated.interviewRate}% of sent`}
          color={COLORS.purple}
          delta={deltas?.interviewed}
        />
        <StatCard
          label="Hired"
          value={fmt(aggregated.hired)}
          sub={`${aggregated.hireRate}% hire rate`}
          color={COLORS.green}
          delta={deltas?.hired}
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

      {timeSeriesData.length > 1 && (
        <>
          <SectionTitle>Trends Over Time</SectionTitle>
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
                  <Area
                    type="monotone"
                    dataKey="sent"
                    name="Sent"
                    stroke={COLORS.blue}
                    fill={COLORS.blue}
                    fillOpacity={0.08}
                  />
                  <Area
                    type="monotone"
                    dataKey="viewed"
                    name="Viewed"
                    stroke={COLORS.cyan}
                    fill={COLORS.cyan}
                    fillOpacity={0.08}
                  />
                  <Area
                    type="monotone"
                    dataKey="interviewed"
                    name="Interviewed"
                    stroke={COLORS.purple}
                    fill={COLORS.purple}
                    fillOpacity={0.08}
                  />
                  <Area
                    type="monotone"
                    dataKey="hired"
                    name="Hired"
                    stroke={COLORS.green}
                    fill={COLORS.green}
                    fillOpacity={0.08}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-gray-600 mb-4">Conversion Rates Over Time</h3>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={timeSeriesData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} />
                  <XAxis
                    dataKey="date"
                    stroke={CHART_AXIS_COLOR}
                    tick={{ fill: CHART_TICK_COLOR, fontSize: 11 }}
                  />
                  <YAxis
                    stroke={CHART_AXIS_COLOR}
                    tick={{ fill: CHART_TICK_COLOR, fontSize: 12 }}
                    unit="%"
                  />
                  <Tooltip {...CHART_TOOLTIP_STYLE} />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="viewRate"
                    name="View Rate"
                    stroke={COLORS.cyan}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="hireRate"
                    name="Hire Rate"
                    stroke={COLORS.green}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {timeSeriesData.some((d) => d.jss !== null) && (
              <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
                <h3 className="text-sm font-semibold text-gray-600 mb-4">JSS Trend</h3>
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={timeSeriesData.filter((d) => d.jss !== null)}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} />
                    <XAxis
                      dataKey="date"
                      stroke={CHART_AXIS_COLOR}
                      tick={{ fill: CHART_TICK_COLOR, fontSize: 11 }}
                    />
                    <YAxis
                      stroke={CHART_AXIS_COLOR}
                      tick={{ fill: CHART_TICK_COLOR, fontSize: 12 }}
                      domain={[0, 100]}
                      unit="%"
                    />
                    <Tooltip {...CHART_TOOLTIP_STYLE} />
                    <Line
                      type="monotone"
                      dataKey="jss"
                      name="JSS"
                      stroke={COLORS.green}
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </>
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
}: {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
  delta?: number | null;
}) {
  const up = delta != null && delta > 0;
  const down = delta != null && delta < 0;
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 flex flex-col gap-2 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-gray-500 uppercase tracking-wider font-medium">{label}</span>
        {delta != null && (
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
        )}
      </div>
      <span
        className="text-2xl font-semibold tracking-tight"
        style={{ color: color || "#111827" }}
      >
        {value}
      </span>
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
