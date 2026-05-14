import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, adminErrorResponse } from "@/lib/admin-auth";

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();
    const { proposalIds } = (await req.json()) as { proposalIds?: string[] };
    if (!Array.isArray(proposalIds) || proposalIds.length === 0) {
      return NextResponse.json({ error: "proposalIds required" }, { status: 400 });
    }

    const proposals = await prisma.proposal.findMany({
      where: { id: { in: proposalIds } },
      select: { id: true, capturedByUserId: true },
    });

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recent = await prisma.nudge.findMany({
      where: {
        proposalId: { in: proposalIds },
        deliveredAt: null,
        createdAt: { gte: oneHourAgo },
      },
      select: { proposalId: true, bidderId: true },
    });
    const recentSet = new Set(
      recent.map((r) => `${r.proposalId}|${r.bidderId}`),
    );

    let created = 0;
    let deduped = 0;
    let skipped = 0;
    const byBidder: Record<string, number> = {};

    for (const p of proposals) {
      if (!p.capturedByUserId) {
        skipped++;
        continue;
      }
      const key = `${p.id}|${p.capturedByUserId}`;
      if (recentSet.has(key)) {
        deduped++;
        continue;
      }
      await prisma.nudge.create({
        data: {
          proposalId: p.id,
          bidderId: p.capturedByUserId,
          createdById: admin.id,
        },
      });
      created++;
      byBidder[p.capturedByUserId] = (byBidder[p.capturedByUserId] || 0) + 1;
    }

    return NextResponse.json({ ok: true, created, deduped, skipped, byBidder });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
