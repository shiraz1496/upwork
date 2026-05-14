import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAttribution } from "@/lib/attribution";

export const GET = withAttribution(async ({ member }) => {
  // Opportunistic cleanup: drop rows older than 7 days regardless of delivery
  // status. Runs on every poll from any bidder — no cron needed.
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  prisma.nudge
    .deleteMany({ where: { createdAt: { lt: sevenDaysAgo } } })
    .catch(() => {});

  const nudges = await prisma.nudge.findMany({
    where: { bidderId: member.id, deliveredAt: null },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      createdAt: true,
      proposalId: true,
      proposal: {
        select: {
          jobTitle: true,
          jobUrl: true,
          account: { select: { name: true } },
        },
      },
    },
  });

  // Group by account so the extension can show one toast per account
  const accountMap = new Map<string, typeof nudges>();
  for (const nudge of nudges) {
    const name = nudge.proposal?.account?.name ?? "Unknown";
    if (!accountMap.has(name)) accountMap.set(name, []);
    accountMap.get(name)!.push(nudge);
  }

  const byAccount = Array.from(accountMap.entries()).map(([accountName, acctNudges]) => ({
    accountName,
    count: acctNudges.length,
    ids: acctNudges.map((n) => n.id),
    single:
      acctNudges.length === 1
        ? {
            jobTitle: acctNudges[0].proposal?.jobTitle ?? null,
            jobUrl: acctNudges[0].proposal?.jobUrl ?? null,
          }
        : null,
  }));

  return NextResponse.json({
    count: nudges.length,
    ids: nudges.map((n) => n.id),
    earliestAt: nudges[0]?.createdAt ?? null,
    byAccount,
  });
});
