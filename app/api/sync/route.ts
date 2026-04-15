import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { freelancerId, accountName, capturedAt, startTimestamp, endTimestamp, totals, series } = body;

    if (!freelancerId) {
      return NextResponse.json({ error: "freelancerId required" }, { status: 400 });
    }

    const account = await prisma.account.upsert({
      where: { freelancerId },
      update: { name: accountName || freelancerId },
      create: { freelancerId, name: accountName || freelancerId },
    });

    const snapshot = await prisma.snapshot.create({
      data: {
        accountId: account.id,
        capturedAt: new Date(capturedAt),
        startTimestamp,
        endTimestamp,
        proposalsSentBoosted: totals.proposals_sent_boosted,
        proposalsSentOrganic: totals.proposals_sent_organic,
        proposalsViewedBoosted: totals.proposals_viewed_boosted,
        proposalsViewedOrganic: totals.proposals_viewed_organic,
        proposalsInterviewedBoosted: totals.proposals_interviewed_boosted,
        proposalsInterviewedOrganic: totals.proposals_interviewed_organic,
        proposalsHiredBoosted: totals.proposals_hired_boosted,
        proposalsHiredOrganic: totals.proposals_hired_organic,
        seriesJson: JSON.stringify(series),
      },
    });

    return NextResponse.json({ ok: true, snapshotId: snapshot.id });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[sync]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
