import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveMeSession, authErrorResponse } from "@/lib/me-auth";

export async function GET(req: NextRequest) {
  try {
    const { member } = await resolveMeSession(req);

    const since = new Date(Date.now() - 8 * 60 * 60 * 1000);
    const url = new URL(req.url);
    const freelancerId = url.searchParams.get("freelancerId");

    const [allPages, items] = await Promise.all([
      prisma.requiredPage.findMany({
        select: { id: true, name: true, url: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.coverageItem.findMany({
        where: { memberId: member.id, referencedAt: { gte: since } },
        orderBy: { referencedAt: "desc" },
      }),
    ]);

    let visitedSet: Set<string>;

    if (freelancerId) {
      // Account-centric: count pages visited by ANY bidder for this account in the last hour
      const account = await prisma.account.findUnique({
        where: { freelancerId },
        select: { id: true },
      });
      if (account) {
        const accountVisits = await prisma.pageVisit.findMany({
          where: { accountId: account.id, visitedAt: { gte: since } },
          select: { pageId: true },
        });
        visitedSet = new Set(accountVisits.map((v) => v.pageId));
      } else {
        visitedSet = new Set();
      }
    } else {
      // Fallback: member-level coverage (no account context)
      const memberVisits = await prisma.pageVisit.findMany({
        where: { memberId: member.id, visitedAt: { gte: since } },
        select: { pageId: true },
      });
      visitedSet = new Set(memberVisits.map((v) => v.pageId));
    }

    const unvisitedPages = allPages.filter((p) => !visitedSet.has(p.id));
    const totalItems = items.length;
    const capturedItems = items.filter((i) => i.capturedAt).length;
    const coveragePct = allPages.length === 0 ? 100 : Math.round((visitedSet.size / allPages.length) * 100);

    return Response.json({
      member: { id: member.id, name: member.name },
      coveragePct,
      totals: {
        pages: { total: allPages.length, visited: visitedSet.size },
        items: { total: totalItems, captured: capturedItems },
      },
      unvisited: unvisitedPages.map((p) => ({ ...p, type: "PAGE" })),
    });

  } catch (err) {
    return authErrorResponse(err);
  }
}
