import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const accounts = await prisma.account.findMany({
      include: {
        snapshots: {
          orderBy: { capturedAt: "desc" },
          take: 30,
        },
      },
    });

    const result = accounts.map((account) => {
      const latest = account.snapshots[0];
      const totalSent = (latest?.proposalsSentBoosted ?? 0) + (latest?.proposalsSentOrganic ?? 0);
      const totalViewed = (latest?.proposalsViewedBoosted ?? 0) + (latest?.proposalsViewedOrganic ?? 0);
      const totalInterviewed = (latest?.proposalsInterviewedBoosted ?? 0) + (latest?.proposalsInterviewedOrganic ?? 0);
      const totalHired = (latest?.proposalsHiredBoosted ?? 0) + (latest?.proposalsHiredOrganic ?? 0);

      return {
        id: account.id,
        freelancerId: account.freelancerId,
        name: account.name,
        latestSnapshot: latest ? {
          capturedAt: latest.capturedAt,
          jss: latest.jss,
          connectsBalance: latest.connectsBalance,
          funnel: { sent: totalSent, viewed: totalViewed, interviewed: totalInterviewed, hired: totalHired },
          boosted: { sent: latest.proposalsSentBoosted, viewed: latest.proposalsViewedBoosted },
          organic: { sent: latest.proposalsSentOrganic, viewed: latest.proposalsViewedOrganic },
        } : null,
        jssTrend: account.snapshots
          .filter((s) => s.jss !== null)
          .map((s) => ({ date: s.capturedAt, jss: s.jss }))
          .reverse(),
        snapshotCount: account.snapshots.length,
      };
    });

    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
