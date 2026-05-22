import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, adminErrorResponse } from "@/lib/admin-auth";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

type Metrics = { sent: number; viewed: number; interviewed: number; hired: number };

function toMetrics(s: {
  proposalsSentBoosted: number; proposalsSentOrganic: number;
  proposalsViewedBoosted: number; proposalsViewedOrganic: number;
  proposalsInterviewedBoosted: number; proposalsInterviewedOrganic: number;
  proposalsHiredBoosted: number; proposalsHiredOrganic: number;
}): Metrics {
  return {
    sent: s.proposalsSentBoosted + s.proposalsSentOrganic,
    viewed: s.proposalsViewedBoosted + s.proposalsViewedOrganic,
    interviewed: s.proposalsInterviewedBoosted + s.proposalsInterviewedOrganic,
    hired: s.proposalsHiredBoosted + s.proposalsHiredOrganic,
  };
}

function addMetrics(a: Metrics, b: Metrics): Metrics {
  return {
    sent: a.sent + b.sent,
    viewed: a.viewed + b.viewed,
    interviewed: a.interviewed + b.interviewed,
    hired: a.hired + b.hired,
  };
}

function withRates(m: Metrics) {
  const rate = (n: number) => m.sent === 0 ? 0 : Math.round((n / m.sent) * 1000) / 10;
  return { ...m, viewRate: rate(m.viewed), interviewRate: rate(m.interviewed), hireRate: rate(m.hired) };
}

function utcDayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function computeComparison(
  range: "7d" | "30d" | "90d",
  memberId?: string,
  accountId?: string,
) {
  const periodDays = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  // Prev snapshot must be within ±tolerance days of the ideal target date.
  // This single check implicitly enforces both min and max gap from cur.
  const toleranceDays = range === "7d" ? 2 : range === "30d" ? 5 : 15;
  const toleranceMs = toleranceDays * MS_PER_DAY;

  const snapshots = await prisma.snapshot.findMany({
    where: {
      range,
      ...(memberId ? { capturedByUserId: memberId } : {}),
      ...(accountId ? { accountId } : {}),
    },
    select: {
      accountId: true,
      capturedAt: true,
      proposalsSentBoosted: true,
      proposalsSentOrganic: true,
      proposalsViewedBoosted: true,
      proposalsViewedOrganic: true,
      proposalsInterviewedBoosted: true,
      proposalsInterviewedOrganic: true,
      proposalsHiredBoosted: true,
      proposalsHiredOrganic: true,
    },
  });

  if (snapshots.length === 0) return null;

  // Group snapshots by account
  const byAccount = new Map<string, typeof snapshots>();
  for (const s of snapshots) {
    const list = byAccount.get(s.accountId) ?? [];
    list.push(s);
    byAccount.set(s.accountId, list);
  }

  let cur: Metrics = { sent: 0, viewed: 0, interviewed: 0, hired: 0 };
  let prev: Metrics = { sent: 0, viewed: 0, interviewed: 0, hired: 0 };
  const prevDatesMs: number[] = [];

  for (const [, acctSnaps] of byAccount) {
    // Deduplicate: keep the latest snapshot for each calendar day (UTC)
    const byDay = new Map<string, (typeof acctSnaps)[0]>();
    for (const s of acctSnaps) {
      const key = utcDayKey(s.capturedAt);
      const existing = byDay.get(key);
      if (!existing || s.capturedAt > existing.capturedAt) byDay.set(key, s);
    }

    // Sort days descending (most recent first)
    const days = Array.from(byDay.entries()).sort(([a], [b]) => b.localeCompare(a));
    if (days.length < 2) continue;

    const latestSnap = days[0][1];
    const latestMs = new Date(days[0][0]).getTime();
    const targetMs = latestMs - periodDays * MS_PER_DAY;

    // Find the candidate day closest to the target (excluding the latest day)
    const candidates = days.slice(1);
    let bestEntry = candidates[0];
    let bestDiff = Math.abs(new Date(candidates[0][0]).getTime() - targetMs);
    for (const entry of candidates.slice(1)) {
      const diff = Math.abs(new Date(entry[0]).getTime() - targetMs);
      if (diff < bestDiff) { bestDiff = diff; bestEntry = entry; }
    }

    // Reject if the best available prev day isn't close enough to the ideal target
    if (bestDiff > toleranceMs) continue;

    const prevMs = new Date(bestEntry[0]).getTime();
    cur = addMetrics(cur, toMetrics(latestSnap));
    prev = addMetrics(prev, toMetrics(bestEntry[1]));
    prevDatesMs.push(prevMs);
  }

  if (prevDatesMs.length === 0) return null;

  // Average prev date across all contributing accounts
  const avgPrevMs = prevDatesMs.reduce((a, b) => a + b, 0) / prevDatesMs.length;
  const prevDate = new Date(avgPrevMs).toLocaleDateString("en-US", { month: "short", day: "numeric" });

  return {
    cur: withRates(cur),
    prev: withRates(prev),
    prevDate,
  };
}

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();

    const { searchParams } = new URL(req.url);
    const memberId = searchParams.get("memberId") ?? undefined;
    const accountId = searchParams.get("accountId") ?? undefined;
    const range = (searchParams.get("range") ?? "7d") as "7d" | "30d" | "90d";

    const result = await computeComparison(range, memberId, accountId);
    return Response.json(result);
  } catch (err) {
    return adminErrorResponse(err);
  }
}
