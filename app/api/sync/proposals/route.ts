import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function tryParseDate(str: string): Date | null {
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { freelancerId, proposals } = body;

    if (!freelancerId || !Array.isArray(proposals)) {
      return NextResponse.json({ error: "freelancerId and proposals array required" }, { status: 400 });
    }

    let account = await prisma.account.findUnique({ where: { freelancerId: String(freelancerId) } });
    if (!account) {
      try {
        account = await prisma.account.create({
          data: { freelancerId: String(freelancerId), name: String(freelancerId) },
        });
      } catch {
        account = await prisma.account.findUnique({ where: { freelancerId: String(freelancerId) } });
      }
    }
    if (!account) {
      return NextResponse.json({ error: "Failed to resolve account" }, { status: 500 });
    }

    let saved = 0;
    for (const p of proposals) {
      if (!p.title) continue;
      const jobUrl = p.url || null;
      const parsedDate = tryParseDate(p.submittedAt);

      const updateData = {
        jobTitle: p.title,
        status: p.status ?? undefined,
        section: p.section ?? undefined,
        boosted: p.boosted ?? false,
        boostStatus: p.boostStatus ?? undefined,
        viewedByClient: p.viewedByClient ?? undefined,
        submittedAt: parsedDate ?? undefined,
        profileUsed: p.profileUsed ?? undefined,
        ...(jobUrl ? { jobUrl } : {}),
      };

      // Find existing by URL first, then by title
      let existing = null;
      if (jobUrl) {
        existing = await prisma.proposal.findFirst({
          where: { accountId: account.id, jobUrl },
        });
      }
      if (!existing) {
        existing = await prisma.proposal.findFirst({
          where: { accountId: account.id, jobTitle: p.title },
        });
      }

      if (existing) {
        await prisma.proposal.update({ where: { id: existing.id }, data: updateData });
      } else {
        await prisma.proposal.create({
          data: {
            accountId: account.id,
            jobTitle: p.title,
            jobUrl: jobUrl,
            status: p.status ?? null,
            section: p.section ?? null,
            boosted: p.boosted ?? false,
            boostStatus: p.boostStatus ?? null,
            viewedByClient: p.viewedByClient ?? false,
            submittedAt: parsedDate ?? null,
            profileUsed: p.profileUsed ?? null,
          },
        });
      }
      saved++;
    }

    return NextResponse.json({ ok: true, saved });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[sync/proposals]", message);
    return NextResponse.json({ error: "Failed to sync proposals" }, { status: 500 });
  }
}
