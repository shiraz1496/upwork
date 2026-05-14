import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, adminErrorResponse } from "@/lib/admin-auth";

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();
    const { proposalId } = await req.json();
    if (!proposalId) {
      return NextResponse.json({ error: "proposalId required" }, { status: 400 });
    }

    const proposal = await prisma.proposal.findUnique({
      where: { id: proposalId },
      select: { id: true, capturedByUserId: true, jobTitle: true },
    });
    if (!proposal) {
      return NextResponse.json({ error: "proposal not found" }, { status: 404 });
    }
    if (!proposal.capturedByUserId) {
      return NextResponse.json(
        { error: "no captured-by user to nudge" },
        { status: 400 },
      );
    }

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recent = await prisma.nudge.findFirst({
      where: {
        proposalId,
        bidderId: proposal.capturedByUserId,
        deliveredAt: null,
        createdAt: { gte: oneHourAgo },
      },
    });
    if (recent) {
      return NextResponse.json({ ok: true, deduped: true });
    }

    const nudge = await prisma.nudge.create({
      data: {
        proposalId,
        bidderId: proposal.capturedByUserId,
        createdById: admin.id,
      },
      include: {
        bidder: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json({ ok: true, nudge });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
