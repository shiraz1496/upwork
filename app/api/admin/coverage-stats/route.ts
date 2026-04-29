import { prisma } from "@/lib/prisma";
import { requireAdmin, adminErrorResponse } from "@/lib/admin-auth";

export async function GET() {
  try {
    await requireAdmin();

    const now = Date.now();
    const pages = await prisma.requiredPage.findMany({ select: { id: true, cooldownHours: true } });
    const totalPages = pages.length;
    // Widest window needed to cover any page's cooldown
    const maxCooldownMs = pages.reduce((m, p) => Math.max(m, p.cooldownHours * 60 * 60 * 1000), 60 * 60 * 1000);
    const maxCooldownAgo = new Date(now - maxCooldownMs);
    const pageCooldownMap = new Map(pages.map((p) => [p.id, p.cooldownHours * 60 * 60 * 1000]));

    // Get all active bidders (exclude admins)
    const bidders = await prisma.teamMember.findMany({
      where: { status: "active", role: "bidder" },
      select: { id: true, name: true },
    });

    if (bidders.length === 0) {
      return Response.json({ accounts: [], totalPages });
    }

    const bidderIds = bidders.map((b) => b.id);
    const bidderById = new Map(bidders.map((b) => [b.id, b]));

    // Use historical captures to determine bidder-account pairs.
    // This covers accounts that exist in the system even if no extension visits have
    // been recorded yet (e.g. Jahan Zeb A. where the bidder owns the account).
    const [snapAccounts, proposalAccounts, jobAccounts] = await Promise.all([
      prisma.snapshot.findMany({
        where: { capturedByUserId: { in: bidderIds } },
        select: { capturedByUserId: true, account: { select: { id: true, name: true } } },
        distinct: ["capturedByUserId", "accountId"],
      }),
      prisma.proposal.findMany({
        where: { capturedByUserId: { in: bidderIds } },
        select: { capturedByUserId: true, account: { select: { id: true, name: true } } },
        distinct: ["capturedByUserId", "accountId"],
      }),
      prisma.job.findMany({
        where: { capturedByUserId: { in: bidderIds } },
        select: { capturedByUserId: true, account: { select: { id: true, name: true } } },
        distinct: ["capturedByUserId", "accountId"],
      }),
    ]);

    // Build account → { name, bidderIds } mapping
    const accountBidderMap = new Map<string, { name: string; bidderIds: Set<string> }>();
    for (const row of [...snapAccounts, ...proposalAccounts, ...jobAccounts]) {
      if (!row.capturedByUserId || !row.account) continue;
      const entry = accountBidderMap.get(row.account.id);
      if (entry) {
        entry.bidderIds.add(row.capturedByUserId);
      } else {
        accountBidderMap.set(row.account.id, {
          name: row.account.name,
          bidderIds: new Set([row.capturedByUserId]),
        });
      }
    }

    if (accountBidderMap.size === 0) {
      return Response.json({ accounts: [], totalPages });
    }

    // For each account, compute per-bidder coverage using account-scoped page visits in the last hour
    const accounts = await Promise.all(
      Array.from(accountBidderMap.entries()).map(async ([accountId, { name, bidderIds: bidderIdSet }]) => {
        const bidderList = Array.from(bidderIdSet);

        const recentVisits = await prisma.pageVisit.findMany({
          where: {
            accountId: accountId,
            memberId: { in: bidderList },
            visitedAt: { gte: maxCooldownAgo },
          },
          select: { memberId: true, pageId: true, visitedAt: true },
        });

        // For each bidder, count pages covered within that page's own cooldown window
        const visitMap = new Map<string, number>();
        for (const bId of bidderList) {
          const bidderVisits = recentVisits.filter((v) => v.memberId === bId);
          let covered = 0;
          for (const v of bidderVisits) {
            const cooldownMs = pageCooldownMap.get(v.pageId);
            if (cooldownMs !== undefined && now - v.visitedAt.getTime() <= cooldownMs) {
              covered++;
            }
          }
          visitMap.set(bId, covered);
        }

        const bidderResults = bidderList.map((bId) => {
          const visited = visitMap.get(bId) ?? 0;
          const pct = totalPages === 0 ? 100 : Math.round((visited / totalPages) * 100);
          return { id: bId, name: bidderById.get(bId)?.name ?? "Unknown", pct, visited };
        });

        // Account is covered if ANY bidder has >= 60% in the last hour
        const best = bidderResults.reduce((a, b) => (b.visited > a.visited ? b : a), { visited: 0, pct: 0 } as { visited: number; pct: number });

        return { id: accountId, name, pct: best.pct, visited: best.visited, bidders: bidderResults };
      }),
    );

    return Response.json({ accounts, totalPages });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
