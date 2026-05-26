import type { AccountData } from "./overview-types";

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
  sent: number;           // cumulative (7d window) — kept for view rate calculation
  viewed: number;
  interviewed: number;
  hired: number;
  proposalsSentOnDay: number; // exact count from proposals.submittedAt for this calendar day
  proposalsViewedOnDay: number; // proposals with viewedByClient=true, bucketed by submittedAt day
  proposalsInterviewedOnDay: number; // proposals in active/interviewing section
  proposalsHiredOnDay: number;       // proposals with hiredAt on this day
  connectsBalance: number | null;
  jss: number | null;
  viewRate: number;
  isLatest: boolean;
};

const isInterviewedSection = (section: string | null) =>
  section != null && /active|offers?|interviewing/i.test(section);

function dayDiff(from: string, to: string): number {
  const f = new Date(from + "T00:00:00").getTime();
  const t = new Date(to + "T00:00:00").getTime();
  return Math.round((t - f) / (24 * 60 * 60 * 1000)) + 1;
}

function shiftDay(day: string, offset: number): string {
  const d = new Date(day + "T00:00:00");
  d.setDate(d.getDate() + offset);
  return localDateKey(d.toISOString());
}

type ProposalTotals = {
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
};

function emptyTotals(): ProposalTotals {
  return {
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
  };
}

export function aggregateProposalsInRange(
  accounts: AccountData[],
  from: string,
  to: string,
): ProposalTotals {
  const totals = emptyTotals();
  for (const account of accounts) {
    for (const p of account.proposals) {
      if (p.submittedAt) {
        const day = localDateKey(p.submittedAt);
        if (day >= from && day <= to) {
          totals.sent += 1;
          if (p.boosted) totals.boostedSent += 1;
          else totals.organicSent += 1;
          const wasViewed = p.viewedByClient || isInterviewedSection(p.section);
          const wasInterviewed = isInterviewedSection(p.section);
          if (wasViewed) {
            totals.viewed += 1;
            if (p.boosted) totals.boostedViewed += 1;
            else totals.organicViewed += 1;
          }
          if (wasInterviewed) {
            totals.interviewed += 1;
            if (p.boosted) totals.boostedInterviewed += 1;
            else totals.organicInterviewed += 1;
          }
        }
      }
      if (p.hiredAt) {
        const day = localDateKey(p.hiredAt);
        if (day >= from && day <= to) {
          totals.hired += 1;
          if (p.boosted) totals.boostedHired += 1;
          else totals.organicHired += 1;
        }
      }
    }
  }
  return totals;
}

export function computeAggregated(accounts: AccountData[], from: string, to: string): Aggregated {
  const totals = aggregateProposalsInRange(accounts, from, to);

  let jss: number | null = null;
  let connectsBalance: number | null = null;
  for (const a of accounts) {
    if (a.jss != null) jss = a.jss;
    if (a.connectsBalance != null) connectsBalance = (connectsBalance ?? 0) + a.connectsBalance;
  }

  const viewRate = totals.sent > 0 ? Math.round((totals.viewed / totals.sent) * 1000) / 10 : 0;
  const interviewRate =
    totals.sent > 0 ? Math.round((totals.interviewed / totals.sent) * 1000) / 10 : 0;
  const hireRate = totals.sent > 0 ? Math.round((totals.hired / totals.sent) * 1000) / 10 : 0;
  const viewToInterview =
    totals.viewed > 0 ? Math.round((totals.interviewed / totals.viewed) * 1000) / 10 : 0;
  const interviewToHire =
    totals.interviewed > 0 ? Math.round((totals.hired / totals.interviewed) * 1000) / 10 : 0;

  return {
    ...totals,
    jss,
    connectsBalance,
    viewRate,
    interviewRate,
    hireRate,
    viewToInterview,
    interviewToHire,
  };
}

export function computeDeltas(accounts: AccountData[], from: string, to: string): Deltas {
  const cmp = computePeriodComparison(accounts, from, to);
  if (!cmp) return null;
  return cmp.delta;
}

export function computePeriodComparison(accounts: AccountData[], from: string, to: string): PeriodComparison {
  const days = dayDiff(from, to);
  const prevTo = shiftDay(from, -1);
  const prevFrom = shiftDay(prevTo, -(days - 1));

  const curTotals = aggregateProposalsInRange(accounts, from, to);
  const prevTotals = aggregateProposalsInRange(accounts, prevFrom, prevTo);

  const cur = {
    sent: curTotals.sent,
    viewed: curTotals.viewed,
    interviewed: curTotals.interviewed,
    hired: curTotals.hired,
  };
  const prev = {
    sent: prevTotals.sent,
    viewed: prevTotals.viewed,
    interviewed: prevTotals.interviewed,
    hired: prevTotals.hired,
  };

  if (
    cur.sent === 0 && cur.viewed === 0 && cur.interviewed === 0 && cur.hired === 0 &&
    prev.sent === 0 && prev.viewed === 0 && prev.interviewed === 0 && prev.hired === 0
  ) {
    return null;
  }

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
  from: string,
  to: string,
): TimeSeriesRow[] {
  type Bucket = {
    sent: number;
    viewed: number;
    interviewed: number;
    hired: number;
    boostedSent: number;
    organicSent: number;
  };
  const byDay = new Map<string, Bucket>();
  const ensureDay = (day: string): Bucket => {
    const existing = byDay.get(day);
    if (existing) return existing;
    const fresh: Bucket = { sent: 0, viewed: 0, interviewed: 0, hired: 0, boostedSent: 0, organicSent: 0 };
    byDay.set(day, fresh);
    return fresh;
  };

  for (const account of accounts) {
    for (const p of account.proposals) {
      if (p.submittedAt) {
        const day = localDateKey(p.submittedAt);
        if (day >= from && day <= to) {
          const entry = ensureDay(day);
          entry.sent += 1;
          if (p.boosted) entry.boostedSent += 1;
          else entry.organicSent += 1;
          if (p.viewedByClient || isInterviewedSection(p.section)) entry.viewed += 1;
          if (isInterviewedSection(p.section)) entry.interviewed += 1;
        }
      }
      if (p.hiredAt) {
        const day = localDateKey(p.hiredAt);
        if (day >= from && day <= to) {
          ensureDay(day).hired += 1;
        }
      }
    }
  }

  return Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, d]) => ({
      date: new Date(day + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      sent: d.sent,
      viewed: d.viewed,
      interviewed: d.interviewed,
      hired: d.hired,
      boostedSent: d.boostedSent,
      organicSent: d.organicSent,
      jss: null,
      connectsBalance: null,
      viewRate: d.sent > 0 ? Math.round((d.viewed / d.sent) * 1000) / 10 : 0,
      hireRate: d.sent > 0 ? Math.round((d.hired / d.sent) * 1000) / 10 : 0,
    }));
}

function localDateKey(isoStr: string): string {
  const d = new Date(isoStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Proposal-driven timeline: one card per day with proposals submitted.
// from/to are YYYY-MM-DD strings in local timezone (matching how dates display).
export function computeSnapshotTimeline(
  accounts: AccountData[],
  from: string,
  to: string,
): TimelineEntry[] {
  const byDay = new Map<string, { sent: number; viewed: number; interviewed: number; hired: number }>();

  const ensureDay = (day: string) => {
    if (!byDay.has(day)) byDay.set(day, { sent: 0, viewed: 0, interviewed: 0, hired: 0 });
    return byDay.get(day)!;
  };

  for (const account of accounts) {
    for (const p of account.proposals) {
      if (p.submittedAt) {
        const day = localDateKey(p.submittedAt);
        if (day >= from && day <= to) {
          const entry = ensureDay(day);
          entry.sent += 1;
          if (p.viewedByClient || isInterviewedSection(p.section)) entry.viewed += 1;
          if (isInterviewedSection(p.section)) entry.interviewed += 1;
        }
      }
      if (p.hiredAt) {
        const hireDay = localDateKey(p.hiredAt);
        if (hireDay >= from && hireDay <= to) {
          ensureDay(hireDay).hired += 1;
        }
      }
    }
  }

  const sorted = Array.from(byDay.entries()).sort(([a], [b]) => a.localeCompare(b));

  return sorted.map(([day, counts], i) => ({
    date: new Date(day + "T00:00:00").toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }),
    capturedAt: day + "T12:00:00",
    sent: counts.sent,
    viewed: counts.viewed,
    interviewed: counts.interviewed,
    hired: 0,
    proposalsSentOnDay: counts.sent,
    proposalsViewedOnDay: counts.viewed,
    proposalsInterviewedOnDay: counts.interviewed,
    proposalsHiredOnDay: counts.hired,
    connectsBalance: null,
    jss: null,
    viewRate: counts.sent > 0 ? Math.round((counts.viewed / counts.sent) * 1000) / 10 : 0,
    isLatest: i === sorted.length - 1,
  }));
}

export function todayKey(): string {
  return localDateKey(new Date().toISOString());
}

export function daysAgoKey(n: number): string {
  return localDateKey(new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString());
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
    proposals: a.proposals.filter((p) => p.capturedBy?.id === memberId),
  }));
}

export function fmt(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return String(n);
}
