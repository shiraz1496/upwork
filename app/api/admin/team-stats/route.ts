import { prisma } from "@/lib/prisma";
import { requireAdmin, adminErrorResponse } from "@/lib/admin-auth";

export async function GET() {
  try {
    await requireAdmin();

    const members = await prisma.teamMember.findMany({
      orderBy: [{ status: "asc" }, { role: "asc" }, { createdAt: "asc" }],
    });

    const stats = await Promise.all(
      members.map(async (m) => {
        const [
          proposalsCount,
          jobsCount,
          alertsCount,
          snapshotsCount,
          coverageReferenced,
          coverageCaptured,
          latestCapture,
        ] = await Promise.all([
          prisma.proposal.count({ where: { capturedByUserId: m.id } }),
          prisma.job.count({ where: { capturedByUserId: m.id } }),
          prisma.alert.count({ where: { capturedByUserId: m.id } }),
          prisma.snapshot.count({ where: { capturedByUserId: m.id } }),
          prisma.coverageItem.count({ where: { memberId: m.id } }),
          prisma.coverageItem.count({ where: { memberId: m.id, capturedAt: { not: null } } }),
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

        const coveragePct =
          coverageReferenced === 0 ? 100 : Math.round((coverageCaptured / coverageReferenced) * 100);

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
            referenced: coverageReferenced,
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
