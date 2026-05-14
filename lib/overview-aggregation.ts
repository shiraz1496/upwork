import type { AccountData, OverviewRange, SnapshotSummary } from "./overview-types";

export type Aggregated = {
  sent: number;
  viewed: number;
  interviewed: number;
  hired: number;
  boostedSent: number;
  organicSent: number;
  boostedViewed: number;
  organicViewed: number;
  boostedInterviewed: number;
  organicInterviewed: number;
  boostedHired: number;
  organicHired: number;
  jss: number | null;
  connectsBalance: number | null;
  viewRate: number;
  interviewRate: number;
  hireRate: number;
  viewToInterview: number;
  interviewToHire: number;
  allSnapshots: SnapshotSummary[];
  snapshotsInRange: SnapshotSummary[];
};

export type Deltas = {
  sent: number | null;
  viewed: number | null;
  interviewed: number | null;
  hired: number | null;
} | null;

export type PeriodComparison = {
  cur: { sent: number; viewed: number; interviewed: number; hired: number };
  prev: { sent: number; viewed: number; interviewed: number; hired: number };
  delta: { sent: number | null; viewed: number | null; interviewed: number | null; hired: number | null };
} | null;

export type TimeSeriesRow = {
  date: string;
  sent: number;
  viewed: number;
  interviewed: number;
  hired: number;
  boostedSent: number;
  organicSent: number;
  jss: number | null;
  connectsBalance: number | null;
  viewRate: number;
  hireRate: number;
};

export type TimelineEntry = {
  date: string;           // "Apr 28"
  capturedAt: string;     // raw ISO for sorting
  sent: number;
  viewed: number;
  interviewed: number;
  hired: number;
  connectsBalance: number | null;
  jss: number | null;
  viewRate: number;
  isLatest: boolean;
};

function fmtDate(d: string): string {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function computeAggregated(accounts: AccountData[], range: OverviewRange): Aggregated {
  const latest = accounts.reduce(
    (acc, a) => {
      const matching = a.snapshots
        .filter((s) => s.range === range)
        .sort((x, y) => new Date(y.capturedAt).getTime() - new Date(x.capturedAt).getTime());
      const ls = matching[0];
      if (!ls) return acc;
      return {
        sent: acc.sent + ls.sent,
        viewed: acc.viewed + ls.viewed,
        interviewed: acc.interviewed + ls.interviewed,
        hired: acc.hired + ls.hired,
        boostedSent: acc.boostedSent + ls.boostedSent,
        organicSent: acc.organicSent + ls.organicSent,
        boostedViewed: acc.boostedViewed + ls.boostedViewed,
        organicViewed: acc.organicViewed + ls.organicViewed,
        boostedInterviewed: acc.boostedInterviewed + ls.boostedInterviewed,
        organicInterviewed: acc.organicInterviewed + ls.organicInterviewed,
        boostedHired: acc.boostedHired + ls.boostedHired,
        organicHired: acc.organicHired + ls.organicHired,
        jss: ls.jss ?? acc.jss ?? a.jss,
        connectsBalance:
          (acc.connectsBalance ?? 0) + (ls.connectsBalance ?? a.connectsBalance ?? 0),
      };
    },
    {
      sent: 0,
      viewed: 0,
      interviewed: 0,
      hired: 0,
      boostedSent: 0,
      organicSent: 0,
      boostedViewed: 0,
      organicViewed: 0,
      boostedInterviewed: 0,
      organicInterviewed: 0,
      boostedHired: 0,
      organicHired: 0,
      jss: null as number | null,
      connectsBalance: null as number | null,
    },
  );

  const allSnapshots = accounts.flatMap((a) => a.snapshots);
  const snapshotsInRange = allSnapshots.filter((s) => s.range === range);
  const viewRate =
    latest.sent > 0 ? Math.round((latest.viewed / latest.sent) * 1000) / 10 : 0;
  const interviewRate =
    latest.sent > 0 ? Math.round((latest.interviewed / latest.sent) * 1000) / 10 : 0;
  const hireRate =
    latest.sent > 0 ? Math.round((latest.hired / latest.sent) * 1000) / 10 : 0;
  const viewToInterview =
    latest.viewed > 0 ? Math.round((latest.interviewed / latest.viewed) * 1000) / 10 : 0;
  const interviewToHire =
    latest.interviewed > 0 ? Math.round((latest.hired / latest.interviewed) * 1000) / 10 : 0;

  return {
    ...latest,
    viewRate,
    interviewRate,
    hireRate,
    viewToInterview,
    interviewToHire,
    allSnapshots,
    snapshotsInRange,
  };
}

export function computeDeltas(accounts: AccountData[], range: OverviewRange): Deltas {
  const cur = { sent: 0, viewed: 0, interviewed: 0, hired: 0 };
  const prev = { sent: 0, viewed: 0, interviewed: 0, hired: 0 };
  let anyPrev = false;
  for (const a of accounts) {
    const matching = a.snapshots
      .filter((s) => s.range === range)
      .sort((x, y) => new Date(y.capturedAt).getTime() - new Date(x.capturedAt).getTime());
    if (matching.length < 2) continue;
    anyPrev = true;
    cur.sent += matching[0].sent;
    cur.viewed += matching[0].viewed;
    cur.interviewed += matching[0].interviewed;
    cur.hired += matching[0].hired;
    prev.sent += matching[1].sent;
    prev.viewed += matching[1].viewed;
    prev.interviewed += matching[1].interviewed;
    prev.hired += matching[1].hired;
  }
  if (!anyPrev) return null;
  const pct = (c: number, p: number) => (p === 0 ? null : Math.round(((c - p) / p) * 100));
  return {
    sent: pct(cur.sent, prev.sent),
    viewed: pct(cur.viewed, prev.viewed),
    interviewed: pct(cur.interviewed, prev.interviewed),
    hired: pct(cur.hired, prev.hired),
  };
}

export function computePeriodComparison(accounts: AccountData[], range: OverviewRange): PeriodComparison {
  const cur = { sent: 0, viewed: 0, interviewed: 0, hired: 0 };
  const prev = { sent: 0, viewed: 0, interviewed: 0, hired: 0 };
  let anyPrev = false;
  for (const a of accounts) {
    const matching = a.snapshots
      .filter((s) => s.range === range)
      .sort((x, y) => new Date(y.capturedAt).getTime() - new Date(x.capturedAt).getTime());
    if (matching.length < 2) continue;
    anyPrev = true;
    cur.sent += matching[0].sent;
    cur.viewed += matching[0].viewed;
    cur.interviewed += matching[0].interviewed;
    cur.hired += matching[0].hired;
    prev.sent += matching[1].sent;
    prev.viewed += matching[1].viewed;
    prev.interviewed += matching[1].interviewed;
    prev.hired += matching[1].hired;
  }
  if (!anyPrev) return null;
  const pct = (c: number, p: number) => (p === 0 ? null : Math.round(((c - p) / p) * 100));
  return {
    cur,
    prev,
    delta: {
      sent: pct(cur.sent, prev.sent),
      viewed: pct(cur.viewed, prev.viewed),
      interviewed: pct(cur.interviewed, prev.interviewed),
      hired: pct(cur.hired, prev.hired),
    },
  };
}

export function computeTimeSeriesData(
  accounts: AccountData[],
  range: OverviewRange,
): TimeSeriesRow[] {
  const byDate = new Map<string, SnapshotSummary & { count: number }>();
  for (const acc of accounts) {
    for (const s of acc.snapshots) {
      if (s.range !== range) continue;
      const dateKey = fmtDate(s.capturedAt);
      const existing = byDate.get(dateKey);
      if (existing) {
        existing.sent += s.sent;
        existing.viewed += s.viewed;
        existing.interviewed += s.interviewed;
        existing.hired += s.hired;
        existing.boostedSent += s.boostedSent;
        existing.organicSent += s.organicSent;
        existing.boostedHired += s.boostedHired;
        existing.organicHired += s.organicHired;
        existing.jss = s.jss ?? existing.jss;
        existing.connectsBalance =
          (existing.connectsBalance ?? 0) + (s.connectsBalance ?? 0);
        existing.count++;
      } else {
        byDate.set(dateKey, { ...s, count: 1 });
      }
    }
  }
  return Array.from(byDate.entries())
    .map(([date, d]) => ({
      date,
      sent: d.sent,
      viewed: d.viewed,
      interviewed: d.interviewed,
      hired: d.hired,
      boostedSent: d.boostedSent,
      organicSent: d.organicSent,
      jss: d.jss,
      connectsBalance: d.connectsBalance,
      viewRate: d.sent > 0 ? Math.round((d.viewed / d.sent) * 1000) / 10 : 0,
      hireRate: d.sent > 0 ? Math.round((d.hired / d.sent) * 1000) / 10 : 0,
    }))
    .sort((a, b) => {
      // byDate key is fmtDate ("Apr 28") which isn't sortable directly;
      // re-sort by the underlying capturedAt stored in the map entry
      const ma = byDate.get(a.date);
      const mb = byDate.get(b.date);
      if (!ma || !mb) return 0;
      return new Date(ma.capturedAt).getTime() - new Date(mb.capturedAt).getTime();
    });
}

// ─── Snapshot Timeline ────────────────────────────────────────────────────────
// Returns one entry per calendar day, summed across all accounts (each account
// contributes its latest snapshot for that day), sorted ascending.
export function computeSnapshotTimeline(
  accounts: AccountData[],
  range: OverviewRange,
): TimelineEntry[] {
  type DayAgg = {
    sent: number; viewed: number; interviewed: number; hired: number;
    connectsBalance: number | null; jss: number | null; latestCapturedAt: string;
  };
  const byDay = new Map<string, DayAgg>();

  for (const account of accounts) {
    // Deduplicate to latest snapshot per UTC day for this account
    const acctByDay = new Map<string, SnapshotSummary>();
    for (const s of account.snapshots.filter((s) => s.range === range)) {
      const day = new Date(s.capturedAt).toISOString().slice(0, 10);
      const existing = acctByDay.get(day);
      if (!existing || new Date(s.capturedAt) > new Date(existing.capturedAt)) {
        acctByDay.set(day, s);
      }
    }

    // Sum this account's daily values into the global aggregation
    for (const [day, s] of acctByDay) {
      const existing = byDay.get(day);
      if (existing) {
        existing.sent += s.sent;
        existing.viewed += s.viewed;
        existing.interviewed += s.interviewed;
        existing.hired += s.hired;
        existing.connectsBalance = (existing.connectsBalance ?? 0) + (s.connectsBalance ?? 0);
        existing.jss = s.jss ?? existing.jss;
        if (s.capturedAt > existing.latestCapturedAt) existing.latestCapturedAt = s.capturedAt;
      } else {
        byDay.set(day, {
          sent: s.sent, viewed: s.viewed, interviewed: s.interviewed, hired: s.hired,
          connectsBalance: s.connectsBalance, jss: s.jss, latestCapturedAt: s.capturedAt,
        });
      }
    }
  }

  const sorted = Array.from(byDay.entries()).sort(([a], [b]) => a.localeCompare(b));

  return sorted.map(([day, d], i) => ({
    date: new Date(day + "T00:00:00Z").toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }),
    capturedAt: d.latestCapturedAt,
    sent: d.sent,
    viewed: d.viewed,
    interviewed: d.interviewed,
    hired: d.hired,
    connectsBalance: d.connectsBalance,
    jss: d.jss,
    viewRate: d.sent > 0 ? Math.round((d.viewed / d.sent) * 1000) / 10 : 0,
    isLatest: i === sorted.length - 1,
  }));
}

export function computeFunnelData(aggregated: Aggregated) {
  return [
    {
      stage: "Sent",
      total: aggregated.sent,
      boosted: aggregated.boostedSent,
      organic: aggregated.organicSent,
    },
    {
      stage: "Viewed",
      total: aggregated.viewed,
      boosted: aggregated.boostedViewed,
      organic: aggregated.organicViewed,
    },
    {
      stage: "Interviewed",
      total: aggregated.interviewed,
      boosted: aggregated.boostedInterviewed,
      organic: aggregated.organicInterviewed,
    },
    {
      stage: "Hired",
      total: aggregated.hired,
      boosted: aggregated.boostedHired,
      organic: aggregated.organicHired,
    },
  ];
}

export function applyMemberFilter(
  accounts: AccountData[],
  memberId: string | null,
): AccountData[] {
  if (!memberId) return accounts;
  return accounts.map((a) => ({
    ...a,
    snapshots: a.snapshots.filter((s) => s.capturedBy?.id === memberId),
  }));
}

export function fmt(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return String(n);
}
