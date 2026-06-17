import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin, adminErrorResponse } from "@/lib/admin-auth";
import { invalidateBlockedTitleCache } from "@/lib/blocked-titles";

const Body = z
  .object({
    dryRun: z.boolean().default(true),
  })
  .default({ dryRun: true });

// Scans the Proposal table (which also holds contracts via `hiredAt`) for any
// row whose `jobTitle` matches an active BlockedTitle entry. Mirrors the
// runtime matching rule in lib/blocked-titles.ts: ≤2-word patterns must match
// exactly (case-insensitive), 3+-word patterns match as substring.
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = Body.parse(await req.json().catch(() => ({})));

    const patterns = await prisma.blockedTitle.findMany({
      where: { active: true },
      select: { pattern: true },
    });

    if (patterns.length === 0) {
      return Response.json({ matched: 0, deleted: 0, sample: [] });
    }

    const exactPatterns: string[] = [];
    const substringPatterns: string[] = [];
    for (const p of patterns) {
      const cleaned = p.pattern.toLowerCase().trim();
      if (!cleaned) continue;
      if (cleaned.split(" ").length >= 3) substringPatterns.push(cleaned);
      else exactPatterns.push(cleaned);
    }

    const where = {
      jobTitle: { not: null },
      OR: [
        ...exactPatterns.map((t) => ({
          jobTitle: { equals: t, mode: "insensitive" as const },
        })),
        ...substringPatterns.map((t) => ({
          jobTitle: { contains: t, mode: "insensitive" as const },
        })),
      ],
    };

    const [matchCount, sample] = await Promise.all([
      prisma.proposal.count({ where }),
      prisma.proposal.findMany({
        where,
        select: {
          id: true,
          jobTitle: true,
          clientCompany: true,
          hiredAt: true,
          contractStatus: true,
          accountId: true,
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
    ]);

    if (body.dryRun || matchCount === 0) {
      return Response.json({ matched: matchCount, deleted: 0, sample });
    }

    const { count } = await prisma.proposal.deleteMany({ where });
    invalidateBlockedTitleCache();
    return Response.json({ matched: matchCount, deleted: count, sample });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return Response.json({ error: "invalid", issues: err.issues }, { status: 400 });
    }
    return adminErrorResponse(err);
  }
}
