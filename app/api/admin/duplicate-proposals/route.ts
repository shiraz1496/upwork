import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { requireAdmin, adminErrorResponse } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";

type RawRow = {
  id: string;
  accountId: string;
  groupKey: string;
  jobUrl: string | null;
  jobTitle: string | null;
  profileUsed: string | null;
  submittedAt: Date | null;
  capturedAt: Date | null;
  clientName: string | null;
  accountName: string;
};

type DbRow = Omit<RawRow, "groupKey">;

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

const SELECT_COLS = Prisma.sql`
  p.id,
  p."accountId",
  p."jobUrl",
  p."jobTitle",
  p."profileUsed",
  p."submittedAt",
  p."capturedAt",
  p."clientName",
  a.name AS "accountName"
`;

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

    // Find all jobTitles (NULL url) that appear across more than one account
    const duplicateTitles = await prisma.$queryRaw<{ jobTitle: string }[]>(
      Prisma.sql`
        SELECT "jobTitle"
        FROM "Proposal"
        WHERE "jobUrl" IS NULL AND "jobTitle" IS NOT NULL
        GROUP BY "jobTitle"
        HAVING COUNT(DISTINCT "accountId") > 1
      `
    );

    if (duplicateUrls.length === 0 && duplicateTitles.length === 0) {
      return Response.json({ tier1: [], tier2: [] });
    }

    const allRows: RawRow[] = [];

    if (duplicateUrls.length > 0) {
      const urls = duplicateUrls.map((r) => r.jobUrl);
      const urlRows = await prisma.$queryRaw<DbRow[]>(
        Prisma.sql`
          SELECT ${SELECT_COLS}
          FROM "Proposal" p
          JOIN "Account" a ON p."accountId" = a.id
          WHERE p."jobUrl" = ANY(${urls})
          ORDER BY p."jobUrl", p."capturedAt"
        `
      );
      for (const r of urlRows) {
        allRows.push({ ...r, groupKey: r.jobUrl! });
      }
    }

    if (duplicateTitles.length > 0) {
      const titles = duplicateTitles.map((r) => r.jobTitle);
      const titleRows = await prisma.$queryRaw<DbRow[]>(
        Prisma.sql`
          SELECT ${SELECT_COLS}
          FROM "Proposal" p
          JOIN "Account" a ON p."accountId" = a.id
          WHERE p."jobUrl" IS NULL AND p."jobTitle" = ANY(${titles})
          ORDER BY p."jobTitle", p."capturedAt"
        `
      );
      for (const r of titleRows) {
        allRows.push({ ...r, groupKey: `title:${r.jobTitle}` });
      }
    }

    // Group rows by groupKey
    const byKey = new Map<string, RawRow[]>();
    for (const row of allRows) {
      const list = byKey.get(row.groupKey) ?? [];
      list.push(row);
      byKey.set(row.groupKey, list);
    }

    // --- Tier 1 detection ---
    // Within ALL duplicate proposals, find proposals belonging to the same
    // account whose capturedAt timestamps fall within 120 seconds of each other.
    // These cluster into "bulk sync events".
    // For each bulk sync event: if those proposals are duplicates of proposals
    // on *other* accounts that were captured *earlier*, mark the bulk-sync ones
    // as toDelete and the earlier ones as toKeep.

    const tier1Map = new Map<
      string,
      { groupKey: string; jobUrl: string | null; jobTitle: string | null; toDelete: RawRow[]; toKeep: RawRow[] }
    >();
    const tier1Keys = new Set<string>();

    // Collect all proposals with a capturedAt, grouped by accountId
    const byAccount = new Map<string, RawRow[]>();
    for (const row of allRows) {
      if (!row.capturedAt) continue;
      const list = byAccount.get(row.accountId) ?? [];
      list.push(row);
      byAccount.set(row.accountId, list);
    }

    // For each account, find clusters of proposals captured within 120 s of each other
    for (const [, accountRows] of byAccount) {
      const sorted = [...accountRows].sort(
        (a, b) => a.capturedAt!.getTime() - b.capturedAt!.getTime()
      );

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
          for (const bulkRow of cluster) {
            const group = byKey.get(bulkRow.groupKey);
            if (!group) continue;

            const otherAccountRows = group.filter(
              (r) => r.accountId !== bulkRow.accountId && r.capturedAt !== null
            );

            const earlierRows = otherAccountRows.filter(
              (r) => r.capturedAt!.getTime() < bulkRow.capturedAt!.getTime()
            );

            if (earlierRows.length > 0) {
              const key = bulkRow.groupKey;
              const existing = tier1Map.get(key) ?? {
                groupKey: key,
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
              tier1Keys.add(key);
            }
          }
        }

        clusterStart = clusterEnd;
      }
    }

    // --- Build tier2: everything not classified as tier1 ---
    const tier2: Array<{
      groupKey: string;
      jobUrl: string | null;
      jobTitle: string | null;
      proposals: ProposalRow[];
    }> = [];

    for (const [key, group] of byKey) {
      if (!tier1Keys.has(key)) {
        tier2.push({
          groupKey: key,
          jobUrl: group[0]?.jobUrl ?? null,
          jobTitle: group[0]?.jobTitle ?? null,
          proposals: group.map(toProposalRow),
        });
      }
    }

    const tier1 = Array.from(tier1Map.values()).map((entry) => ({
      groupKey: entry.groupKey,
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
