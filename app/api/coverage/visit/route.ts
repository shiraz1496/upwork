import { NextRequest } from "next/server";
import { z } from "zod";
import { withAttribution } from "@/lib/attribution";
import { prisma } from "@/lib/prisma";

const Body = z.object({ pageId: z.string(), freelancerId: z.string().optional() });

export const POST = withAttribution(async ({ req, member }: { req: NextRequest; member: { id: string } }) => {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: "invalid" }, { status: 400 });
  }

  const { pageId, freelancerId } = parsed.data;
  const page = await prisma.requiredPage.findUnique({ where: { id: pageId } });
  if (!page) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  // Resolve freelancerId to accountId
  let accountId: string | null = null;
  if (freelancerId) {
    const account = await prisma.account.findUnique({ where: { freelancerId }, select: { id: true } });
    if (account) accountId = account.id;
  }

  if (!accountId) {
    return Response.json({ ok: true, skipped: true });
  }

  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  // Check if this page is currently covered for this account (any bidder visited in the last hour)
  const alreadyCovered = await prisma.pageVisit.findFirst({
    where: {
      pageId,
      accountId,
      visitedAt: { gte: oneHourAgo },
    },
    select: { id: true },
  });

  // Always update PageVisit so the real-time coverage display stays accurate
  await prisma.pageVisit.upsert({
    where: { pageId_memberId_accountId: { pageId, memberId: member.id, accountId } },
    update: { visitedAt: now },
    create: { pageId, memberId: member.id, accountId },
  });

  // Only log a coverage event when the page was uncovered — this is the leaderboard score
  if (!alreadyCovered) {
    await prisma.visitLog.create({
      data: { pageId, memberId: member.id, accountId, coveredAt: now },
    });
  }

  return Response.json({ ok: true, scored: !alreadyCovered });
});
