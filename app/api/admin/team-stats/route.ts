import { prisma } from "@/lib/prisma";
import { requireAdmin, adminErrorResponse } from "@/lib/admin-auth";

export async function GET() {
  try {
    await requireAdmin();

    const members = await prisma.teamMember.findMany({
      where: { role: "bidder" },
      orderBy: [{ status: "asc" }, { createdAt: "asc" }],
    });

    const requiredPages = await prisma.requiredPage.findMany({
      select: { id: true, cooldownHours: true },
    });
    const totalPages = requiredPages.length;
    const pageCooldownMap = new Map(
      requiredPages.map((p) => [p.id, p.cooldownHours * 3600 * 1000]),
    );
    const maxCooldownMs = requiredPages.reduce(
      (m, p) => Math.max(m, p.cooldownHours * 3600 * 1000),
      3600 * 1000,
    );

    const now = Date.now();
    const maxCooldownAgo = new Date(now - maxCooldownMs);

    const stats = await Promise.all(
      members.map(async (m) => {
        const [
          proposalsCount,
          jobsCount,
          alertsCount,
          snapshotsCount,
          recentVisits,
          latestCapture,
        ] = await Promise.all([
          prisma.proposal.count({ where: { capturedByUserId: m.id } }),
          prisma.job.count({ where: { capturedByUserId: m.id } }),
          prisma.alert.count({ where: { capturedByUserId: m.id } }),
          prisma.snapshot.count({ where: { capturedByUserId: m.id } }),
          prisma.pageVisit.findMany({
            where: { memberId: m.id, visitedAt: { gte: maxCooldownAgo } },
            select: { pageId: true, visitedAt: true },
          }),
          Promise.all([
            prisma.proposal.findFirst({ where: { capturedByUserId: m.id }, orderBy: { capturedAt: "desc" }, select: { capturedAt: true } }),
            prisma.job.findFirst({ where: { capturedByUserId: m.id }, orderBy: { capturedAt: "desc" }, select: { capturedAt: true } }),
            prisma.alert.findFirst({ where: { capturedByUserId: m.id }, orderBy: { capturedAt: "desc" }, select: { capturedAt: true } }),
            prisma.snapshot.findFirst({ where: { capturedByUserId: m.id }, orderBy: { capturedAt: "desc" }, select: { capturedAt: true } }),
          ]).then((rows) => {
            const dates = rows.map((r) => r?.capturedAt).filter((d): d is Date => d != null);
            if (dates.length === 0) return null;
            return new Date(Math.max(...dates.map((d) => d.getTime())));
          }),
        ]);

        // Count distinct required pages this member visited within each page's own cooldown window
        const coveredPageIds = new Set<string>();
        for (const v of recentVisits) {
          const cooldownMs = pageCooldownMap.get(v.pageId);
          if (cooldownMs !== undefined && now - v.visitedAt.getTime() <= cooldownMs) {
            coveredPageIds.add(v.pageId);
          }
        }
        const coverageCaptured = coveredPageIds.size;
        const coveragePct = totalPages === 0 ? 100 : Math.round((coverageCaptured / totalPages) * 100);

        return {
          id: m.id,
          name: m.name,
          email: m.email,
          role: m.role,
          status: m.status,
          captured: {
            proposals: proposalsCount,
            jobs: jobsCount,
            alerts: alertsCount,
            snapshots: snapshotsCount,
          },
          coverage: {
            referenced: totalPages,
            captured: coverageCaptured,
            pct: coveragePct,
          },
          latestCaptureAt: latestCapture,
        };
      }),
    );

    return Response.json({ members: stats });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
