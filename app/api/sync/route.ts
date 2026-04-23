import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const syncSchema = z.object({
  freelancerId: z.string().min(1, "freelancerId required"),
  accountName: z.string().optional().nullable(),
  capturedAt: z.string().datetime().optional(),
  startTimestamp: z.string().optional().nullable(),
  endTimestamp: z.string().optional().nullable(),
  range: z.string().optional().nullable(),
  jss: z.number().min(0).max(100).optional().nullable(),
  connectsBalance: z.number().int().min(0).optional().nullable(),
  totals: z.object({
    proposals_sent_boosted: z.number().int().default(0),
    proposals_sent_organic: z.number().int().default(0),
    proposals_viewed_boosted: z.number().int().default(0),
    proposals_viewed_organic: z.number().int().default(0),
    proposals_interviewed_boosted: z.number().int().default(0),
    proposals_interviewed_organic: z.number().int().default(0),
    proposals_hired_boosted: z.number().int().default(0),
    proposals_hired_organic: z.number().int().default(0),
  }),
  series: z.any().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = syncSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join(", ") },
        { status: 400 }
      );
    }

    const { freelancerId, accountName, capturedAt, startTimestamp, endTimestamp, range, jss, connectsBalance, totals, series } = parsed.data;

    let account = await prisma.account.findUnique({ where: { freelancerId } });
    if (account) {
      account = await prisma.account.update({
        where: { freelancerId },
        data: {
          ...(accountName ? { name: accountName } : {}),
          ...(jss != null ? { jss } : {}),
          ...(connectsBalance != null ? { connectsBalance } : {}),
        },
      });
    } else {
      try {
        account = await prisma.account.create({
          data: { freelancerId, name: accountName || freelancerId },
        });
      } catch {
        account = await prisma.account.findUnique({ where: { freelancerId } });
      }
    }
    if (!account) {
      return NextResponse.json({ error: "Failed to resolve account" }, { status: 500 });
    }

    const snapshot = await prisma.snapshot.create({
      data: {
        accountId: account.id,
        capturedAt: capturedAt ? new Date(capturedAt) : new Date(),
        startTimestamp: startTimestamp ?? null,
        endTimestamp: endTimestamp ?? null,
        range: range ?? null,
        jss: jss ?? null,
        connectsBalance: connectsBalance ?? null,
        proposalsSentBoosted: totals.proposals_sent_boosted,
        proposalsSentOrganic: totals.proposals_sent_organic,
        proposalsViewedBoosted: totals.proposals_viewed_boosted,
        proposalsViewedOrganic: totals.proposals_viewed_organic,
        proposalsInterviewedBoosted: totals.proposals_interviewed_boosted,
        proposalsInterviewedOrganic: totals.proposals_interviewed_organic,
        proposalsHiredBoosted: totals.proposals_hired_boosted,
        proposalsHiredOrganic: totals.proposals_hired_organic,
        seriesJson: series ? JSON.stringify(series) : null,
      },
    });

    return NextResponse.json({ ok: true, snapshotId: snapshot.id });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[sync]", message);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
