import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { requireAdmin, adminErrorResponse } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";

type RawRow = {
  id: string;
  accountId: string;
  jobUrl: string;
  jobTitle: string | null;
  profileUsed: string | null;
  submittedAt: Date | null;
  capturedAt: Date | null;
  clientName: string | null;
  accountName: string;
};

type ProposalRow = {
  id: string;
  accountId: string;
  accountName: string;
  profileUsed: string | null;
  submittedAt: string | null;
  capturedAt: string | null;
  clientName: string | null;
};

function toProposalRow(r: RawRow): ProposalRow {
  return {
    id: r.id,
    accountId: r.accountId,
    accountName: r.accountName,
    profileUsed: r.profileUsed,
    submittedAt: r.submittedAt ? r.submittedAt.toISOString() : null,
    capturedAt: r.capturedAt ? r.capturedAt.toISOString() : null,
    clientName: r.clientName,
  };
}

export async function GET() {
  try {
    await requireAdmin();

    // Find all jobUrls that appear across more than one account
    const duplicateUrls = await prisma.$queryRaw<{ jobUrl: string }[]>(
      Prisma.sql`
        SELECT "jobUrl"
        FROM "Proposal"
        WHERE "jobUrl" IS NOT NULL
        GROUP BY "jobUrl"
        HAVING COUNT(DISTINCT "accountId") > 1
      `
    );

    if (duplicateUrls.length === 0) {
      return Response.json({ tier1: [], tier2: [] });
    }

    const urls = duplicateUrls.map((r) => r.jobUrl);

    const rows = await prisma.$queryRaw<RawRow[]>(
      Prisma.sql`
        SELECT
          p.id,
          p."accountId",
          p."jobUrl",
          p."jobTitle",
          p."profileUsed",
          p."submittedAt",
          p."capturedAt",
          p."clientName",
          a.name AS "accountName"
        FROM "Proposal" p
        JOIN "Account" a ON p."accountId" = a.id
        WHERE p."jobUrl" = ANY(${urls})
        ORDER BY p."jobUrl", p."capturedAt"
      `
    );

    // Group rows by jobUrl
    const byUrl = new Map<string, RawRow[]>();
    for (const row of rows) {
      const list = byUrl.get(row.jobUrl) ?? [];
      list.push(row);
      byUrl.set(row.jobUrl, list);
    }

    // --- Tier 1 detection ---
    // Within ALL duplicate proposals, find proposals belonging to the same
    // account whose capturedAt timestamps fall within 120 seconds of each other.
    // These cluster into "bulk sync events".
    // For each bulk sync event: if those proposals are duplicates of proposals
    // on *other* accounts that were captured *earlier*, mark the bulk-sync ones
    // as toDelete and the earlier ones as toKeep. This is Tier 1.

    const tier1Map = new Map<
      string,
      { jobUrl: string; jobTitle: string | null; toDelete: RawRow[]; toKeep: RawRow[] }
    >();
    const tier1JobUrls = new Set<string>();

    // Collect all proposals with a capturedAt, grouped by accountId
    const byAccount = new Map<string, RawRow[]>();
    for (const row of rows) {
      if (!row.capturedAt) continue;
      const list = byAccount.get(row.accountId) ?? [];
      list.push(row);
      byAccount.set(row.accountId, list);
    }

    // For each account, find clusters of proposals captured within 120 s of each other
    for (const [, accountRows] of byAccount) {
      // Sort by capturedAt ascending
      const sorted = [...accountRows].sort(
        (a, b) => a.capturedAt!.getTime() - b.capturedAt!.getTime()
      );

      // Sliding-window cluster: group consecutive proposals within 120 s
      let clusterStart = 0;
      while (clusterStart < sorted.length) {
        const anchor = sorted[clusterStart].capturedAt!.getTime();
        let clusterEnd = clusterStart + 1;
        while (
          clusterEnd < sorted.length &&
          sorted[clusterEnd].capturedAt!.getTime() - anchor <= 120_000
        ) {
          clusterEnd++;
        }
        const cluster = sorted.slice(clusterStart, clusterEnd);

        if (cluster.length > 1) {
          // This is a bulk sync event — check each proposal in the cluster
          for (const bulkRow of cluster) {
            // Is this proposal a duplicate of one on another account?
            const group = byUrl.get(bulkRow.jobUrl);
            if (!group) {
              clusterStart++;
              continue;
            }
            const otherAccountRows = group.filter(
              (r) => r.accountId !== bulkRow.accountId && r.capturedAt !== null
            );

            // Are there earlier captures on other accounts?
            const earlierRows = otherAccountRows.filter(
              (r) => r.capturedAt!.getTime() < bulkRow.capturedAt!.getTime()
            );

            if (earlierRows.length > 0) {
              // Mark bulkRow as toDelete, earlierRows as toKeep
              const key = bulkRow.jobUrl;
              const existing = tier1Map.get(key) ?? {
                jobUrl: bulkRow.jobUrl,
                jobTitle: bulkRow.jobTitle,
                toDelete: [],
                toKeep: [],
              };

              if (!existing.toDelete.find((r) => r.id === bulkRow.id)) {
                existing.toDelete.push(bulkRow);
              }
              for (const keeper of earlierRows) {
                if (!existing.toKeep.find((r) => r.id === keeper.id)) {
                  existing.toKeep.push(keeper);
                }
              }
              tier1Map.set(key, existing);
              tier1JobUrls.add(key);
            }
          }
        }

        clusterStart = clusterEnd;
      }
    }

    // --- Build tier2: everything not classified as tier1 ---
    const tier2: Array<{
      jobUrl: string;
      jobTitle: string | null;
      proposals: ProposalRow[];
    }> = [];

    for (const [jobUrl, group] of byUrl) {
      if (!tier1JobUrls.has(jobUrl)) {
        tier2.push({
          jobUrl,
          jobTitle: group[0]?.jobTitle ?? null,
          proposals: group.map(toProposalRow),
        });
      }
    }

    const tier1 = Array.from(tier1Map.values()).map((entry) => ({
      jobUrl: entry.jobUrl,
      jobTitle: entry.jobTitle,
      toDelete: entry.toDelete.map(toProposalRow),
      toKeep: entry.toKeep.map(toProposalRow),
    }));

    return Response.json({ tier1, tier2 });
  } catch (err) {
    return adminErrorResponse(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await requireAdmin();

    const body = await req.json();
    const { ids } = body;

    if (
      !Array.isArray(ids) ||
      ids.length === 0 ||
      ids.some((id) => typeof id !== "string")
    ) {
      return Response.json(
        { error: "ids must be a non-empty array of strings" },
        { status: 400 }
      );
    }

    const result = await prisma.proposal.deleteMany({
      where: { id: { in: ids } },
    });

    return Response.json({ deleted: result.count });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
