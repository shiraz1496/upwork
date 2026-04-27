import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, adminErrorResponse } from "@/lib/admin-auth";

type TimelineItem = {
  kind: "proposal" | "job" | "alert" | "snapshot";
  at: Date;
  title: string;
  url: string | null;
  by: { id: string; name: string } | null;
  subjectId: string;
};

export async function GET(
  _req: NextRequest,
  ctx: RouteContext<"/api/admin/profile/[accountId]/timeline">,
) {
  try {
    await requireAdmin();
    const { accountId } = await ctx.params;

    const account = await prisma.account.findUnique({
      where: { id: accountId },
      select: { id: true, name: true, freelancerId: true },
    });
    if (!account) return Response.json({ error: "not found" }, { status: 404 });

    const [proposals, jobs, alerts, snapshots] = await Promise.all([
      prisma.proposal.findMany({
        where: { accountId, capturedAt: { not: null } },
        include: { capturedByUser: { select: { id: true, name: true } } },
        orderBy: { capturedAt: "desc" },
        take: 100,
      }),
      prisma.job.findMany({
        where: { accountId, capturedAt: { not: null } },
        include: { capturedByUser: { select: { id: true, name: true } } },
        orderBy: { capturedAt: "desc" },
        take: 100,
      }),
      prisma.alert.findMany({
        where: { accountId, capturedAt: { not: null } },
        include: { capturedByUser: { select: { id: true, name: true } } },
        orderBy: { capturedAt: "desc" },
        take: 100,
      }),
      prisma.snapshot.findMany({
        where: { accountId },
        include: { capturedByUser: { select: { id: true, name: true } } },
        orderBy: { capturedAt: "desc" },
        take: 50,
      }),
    ]);

    const items: TimelineItem[] = [
      ...proposals.map((p) => ({
        kind: "proposal" as const,
        at: p.capturedAt!,
        title: p.jobTitle || "(untitled proposal)",
        url: p.jobUrl,
        by: p.capturedByUser ? { id: p.capturedByUser.id, name: p.capturedByUser.name } : null,
        subjectId: p.id,
      })),
      ...jobs.map((j) => ({
        kind: "job" as const,
        at: j.capturedAt!,
        title: j.title,
        url: j.url,
        by: j.capturedByUser ? { id: j.capturedByUser.id, name: j.capturedByUser.name } : null,
        subjectId: j.id,
      })),
      ...alerts.map((a) => ({
        kind: "alert" as const,
        at: a.capturedAt!,
        title: a.title || `Message from ${a.senderName || "Unknown"}`,
        url: a.url,
        by: a.capturedByUser ? { id: a.capturedByUser.id, name: a.capturedByUser.name } : null,
        subjectId: a.id,
      })),
      ...snapshots.map((s) => ({
        kind: "snapshot" as const,
        at: s.capturedAt,
        title: `Stats snapshot (${s.range || "custom range"})`,
        url: null,
        by: s.capturedByUser ? { id: s.capturedByUser.id, name: s.capturedByUser.name } : null,
        subjectId: s.id,
      })),
    ];

    items.sort((a, b) => b.at.getTime() - a.at.getTime());

    return Response.json({
      account,
      items: items.slice(0, 200),
      total: items.length,
    });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
