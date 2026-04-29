import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveMeSession, authErrorResponse } from "@/lib/me-auth";

export async function GET(req: NextRequest) {
  try {
    const { member } = await resolveMeSession(req);

    const now = Date.now();
    const url = new URL(req.url);
    const freelancerId = url.searchParams.get("freelancerId");

    const allPages = await prisma.requiredPage.findMany({
      select: { id: true, name: true, url: true, cooldownHours: true },
      orderBy: { createdAt: "asc" },
    });

    // Query within the widest cooldown window across all pages
    const maxCooldownMs = allPages.reduce((m, p) => Math.max(m, p.cooldownHours * 60 * 60 * 1000), 60 * 60 * 1000);
    const maxCooldownAgo = new Date(now - maxCooldownMs);

    let recentVisits: { pageId: string; visitedAt: Date }[];

    if (freelancerId) {
      const account = await prisma.account.findUnique({ where: { freelancerId }, select: { id: true } });
      if (account) {
        recentVisits = await prisma.pageVisit.findMany({
          where: { accountId: account.id, visitedAt: { gte: maxCooldownAgo } },
          select: { pageId: true, visitedAt: true },
        });
      } else {
        recentVisits = [];
      }
    } else {
      recentVisits = await prisma.pageVisit.findMany({
        where: { memberId: member.id, visitedAt: { gte: maxCooldownAgo } },
        select: { pageId: true, visitedAt: true },
      });
    }

    // For each page, check if the most recent visit is within that page's own cooldown
    const visitedSet = new Set<string>();
    for (const page of allPages) {
      const cooldownMs = page.cooldownHours * 60 * 60 * 1000;
      const hasValidVisit = recentVisits.some(
        (v) => v.pageId === page.id && now - v.visitedAt.getTime() <= cooldownMs
      );
      if (hasValidVisit) visitedSet.add(page.id);
    }

    const since = new Date(now - 8 * 60 * 60 * 1000);
    const items = await prisma.coverageItem.findMany({
      where: { memberId: member.id, referencedAt: { gte: since } },
      orderBy: { referencedAt: "desc" },
    });

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
      unvisited: unvisitedPages.map(({ cooldownHours: _, ...p }) => ({ ...p, type: "PAGE" })),
    });

  } catch (err) {
    return authErrorResponse(err);
  }
}
