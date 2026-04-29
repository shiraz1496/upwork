import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, adminErrorResponse } from "@/lib/admin-auth";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();

    const { searchParams } = new URL(req.url);
    const monthParam = searchParams.get("month"); // expected: "YYYY-MM"

    let year: number;
    let month: number; // 1-based

    if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
      [year, month] = monthParam.split("-").map(Number);
    } else {
      const now = new Date();
      year = now.getFullYear();
      month = now.getMonth() + 1;
    }

    const monthStart = new Date(year, month - 1, 1, 0, 0, 0, 0);
    const monthEnd = new Date(year, month, 1, 0, 0, 0, 0);

    const totalPages = await prisma.requiredPage.count();

    const members = await prisma.teamMember.findMany({
      where: { status: "active", role: "bidder" },
      select: { id: true, name: true, email: true, role: true },
      orderBy: { name: "asc" },
    });

    // Count coverage events per member for this month
    const eventCounts = await prisma.visitLog.groupBy({
      by: ["memberId"],
      where: {
        coveredAt: { gte: monthStart, lt: monthEnd },
        memberId: { in: members.map((m) => m.id) },
      },
      _count: { id: true },
    });

    const countByMember = new Map(eventCounts.map((e) => [e.memberId, e._count.id]));
    const topCount = Math.max(...countByMember.values(), 1);

    const results = members.map((m) => {
      const events = countByMember.get(m.id) ?? 0;
      return {
        id: m.id,
        name: m.name,
        email: m.email,
        role: m.role,
        events,
        // Relative bar width against the top scorer (not a real %)
        relativePct: Math.round((events / topCount) * 100),
      };
    });

    results.sort((a, b) => b.events - a.events || a.name.localeCompare(b.name));

    return Response.json({
      month: `${year}-${String(month).padStart(2, "0")}`,
      totalPages,
      results,
    });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
