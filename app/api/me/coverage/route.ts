import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveMeSession, authErrorResponse } from "@/lib/me-auth";

export async function GET(req: NextRequest) {
  try {
    const { member } = await resolveMeSession(req);

    const since = new Date(Date.now() - 1 * 60 * 60 * 1000);

    const [allPages, recentVisits, items] = await Promise.all([
      prisma.requiredPage.findMany({
        select: { id: true, name: true, url: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.pageVisit.findMany({
        where: { memberId: member.id, visitedAt: { gte: since } },
        select: { pageId: true },
      }),
      prisma.coverageItem.findMany({
        where: { memberId: member.id, referencedAt: { gte: since } },
        orderBy: { referencedAt: "desc" },
      }),
    ]);

    const visitedSet = new Set(recentVisits.map((v) => v.pageId));
    const unvisitedPages = allPages.filter((p) => !visitedSet.has(p.id));

    const totalItems = items.length;
    const capturedItems = items.filter((i) => i.capturedAt).length;
    const uncapturedItems = items.filter((i) => !i.capturedAt);

    // Weighted average: Checklist (50%) + Dynamic Items (50%)
    const checklistScore = allPages.length === 0 ? 100 : (visitedSet.size / allPages.length) * 100;
    const itemsScore = totalItems === 0 ? 100 : (capturedItems / totalItems) * 100;
    const coveragePct = Math.round((checklistScore + itemsScore) / 2);

    return Response.json({
      member: { id: member.id, name: member.name },
      coveragePct,
      totals: {
        pages: { total: allPages.length, visited: visitedSet.size },
        items: { total: totalItems, captured: capturedItems },
      },
      unvisited: [
        ...unvisitedPages.map((p) => ({ ...p, type: "PAGE" })),
        ...uncapturedItems.map((i) => ({
          id: i.id,
          name: i.entityId,
          url: i.openUrl,
          type: i.entityType,
        })),
      ],
    });

  } catch (err) {
    return authErrorResponse(err);
  }
}
