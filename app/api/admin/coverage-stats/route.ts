import { prisma } from "@/lib/prisma";
import { requireAdmin, adminErrorResponse } from "@/lib/admin-auth";

export async function GET() {
  try {
    await requireAdmin();

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const [activeMembers, totalPages] = await Promise.all([
      prisma.teamMember.findMany({
        where: { status: "active" },
        orderBy: { name: "asc" },
        include: {
          _count: {
            select: {
              pageVisits: { where: { visitedAt: { gte: oneHourAgo } } },
            },
          },
        },
      }),
      prisma.requiredPage.count(),
    ]);

    const members = activeMembers.map((m) => {
      const visitedPages = m._count.pageVisits;
      const pct = totalPages === 0 ? 100 : Math.round((visitedPages / totalPages) * 100);
      return {
        id: m.id,
        name: m.name,
        email: m.email,
        role: m.role,
        status: m.status,
        totalPages,
        visitedPages,
        pct,
      };
    });

    return Response.json({ members, totalPages });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
