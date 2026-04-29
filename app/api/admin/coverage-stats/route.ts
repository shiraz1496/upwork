import { prisma } from "@/lib/prisma";
import { requireAdmin, adminErrorResponse } from "@/lib/admin-auth";

export async function GET() {
  try {
    await requireAdmin();

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const totalPages = await prisma.requiredPage.count();

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
            visitedAt: { gte: oneHourAgo },
          },
          select: { memberId: true },
        });

        const visitMap = new Map<string, number>();
        for (const v of recentVisits) {
          visitMap.set(v.memberId, (visitMap.get(v.memberId) ?? 0) + 1);
        }

        const bidderResults = bidderList.map((bId) => {
          const visitedPages = visitMap.get(bId) ?? 0;
          const pct = totalPages === 0 ? 100 : Math.round((visitedPages / totalPages) * 100);
          return { id: bId, name: bidderById.get(bId)?.name ?? "Unknown", pct };
        });

        // Account is covered if ANY bidder has >= 60% in the last hour
        const maxPct = bidderResults.length === 0 ? 0 : Math.max(...bidderResults.map((b) => b.pct));

        return { id: accountId, name, pct: maxPct, bidders: bidderResults };
      }),
    );

    return Response.json({ accounts, totalPages });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
