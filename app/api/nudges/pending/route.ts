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
      proposal: { select: { jobTitle: true, jobUrl: true } },
    },
  });

  const single =
    nudges.length === 1
      ? {
          jobTitle: nudges[0].proposal?.jobTitle ?? null,
          jobUrl: nudges[0].proposal?.jobUrl ?? null,
        }
      : null;

  return NextResponse.json({
    count: nudges.length,
    ids: nudges.map((n) => n.id),
    earliestAt: nudges[0]?.createdAt ?? null,
    single,
  });
});
