import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveMeSession, authErrorResponse } from "@/lib/me-auth";

export async function GET(req: NextRequest) {
  try {
    const { member } = await resolveMeSession(req);

    const [items, totalWithRef, capturedCount] = await Promise.all([
      prisma.coverageItem.findMany({
        where: { memberId: member.id, capturedAt: null },
        orderBy: [{ priority: "desc" }, { referencedAt: "desc" }],
        take: 100,
      }),
      prisma.coverageItem.count({ where: { memberId: member.id } }),
      prisma.coverageItem.count({
        where: { memberId: member.id, capturedAt: { not: null } },
      }),
    ]);

    const coveragePct =
      totalWithRef === 0 ? 100 : Math.round((capturedCount / totalWithRef) * 100);

    return Response.json({
      member: { id: member.id, name: member.name },
      coveragePct,
      totals: {
        referenced: totalWithRef,
        captured: capturedCount,
        uncovered: items.length,
      },
      items: items.map((i) => ({
        id: i.id,
        entityType: i.entityType,
        entityId: i.entityId,
        openUrl: i.openUrl,
        reasonTags: i.reasonTags,
        referencedAt: i.referencedAt,
        priority: i.priority,
      })),
    });
  } catch (err) {
    return authErrorResponse(err);
  }
}
