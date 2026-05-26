import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAttribution, resolveAccount } from "@/lib/attribution";

function parseContractDate(str: string | null | undefined): Date | null {
  if (!str || /^\s*$/.test(str)) return null;
  const cleaned = str.trim();
  // Already has a year
  const withYear = /\d{4}/.test(cleaned) ? cleaned : `${cleaned} ${new Date().getFullYear()}`;
  const d = new Date(withYear);
  if (isNaN(d.getTime())) return null;
  // If date lands in the future it must be from last year
  if (d > new Date()) d.setFullYear(d.getFullYear() - 1);
  return d;
}

export const POST = withAttribution(async ({ req }) => {
  try {
    const body = await req.json();
    const { freelancerId, contracts } = body;

    if (!freelancerId || !Array.isArray(contracts)) {
      return NextResponse.json({ error: "freelancerId and contracts array required" }, { status: 400 });
    }

    console.log("[sync/contracts] freelancerId:", freelancerId, "contracts:", contracts.length);
    contracts.forEach((c: Record<string, unknown>, i: number) => console.log(`  [${i}]`, JSON.stringify(c)));

    const account = await resolveAccount(freelancerId);
    if (!account) return NextResponse.json({ error: "Failed to resolve account" }, { status: 500 });

    let updated = 0;
    for (const c of contracts) {
      if (!c.title) {
        console.log("[sync/contracts] skipping contract with no title:", JSON.stringify(c));
        continue;
      }

      const hiredAt = parseContractDate(c.startDate);
      const contractEndedAt = parseContractDate(c.endDate);

      // Match: jobUrl first (most precise), then exact title within same account
      let proposal = null;
      if (c.jobUrl) {
        proposal = await prisma.proposal.findFirst({
          where: { accountId: account.id, jobUrl: c.jobUrl },
        });
      }
      if (!proposal) {
        proposal = await prisma.proposal.findFirst({
          where: {
            accountId: account.id,
            jobTitle: { equals: c.title, mode: "insensitive" },
          },
        });
      }

      if (!proposal) {
        console.log("[sync/contracts] No match for:", JSON.stringify(c.title), "account:", account.id);
        continue;
      }

      console.log("[sync/contracts] Matched proposal", proposal.id, "title:", proposal.jobTitle, "hiredAt:", proposal.hiredAt, "→ incoming startDate:", c.startDate);
      await prisma.proposal.update({
        where: { id: proposal.id },
        data: {
          // Never overwrite an existing hiredAt — first accurate timestamp wins
          ...(hiredAt && !proposal.hiredAt ? { hiredAt } : {}),
          contractEndedAt: contractEndedAt ?? undefined,
          contractStatus: c.status ?? undefined,
          contractRating: c.rating != null ? Number(c.rating) : undefined,
          contractBudget: c.budget ?? undefined,
          contractRate: c.rate ?? undefined,
          contractWeeklyLimit: c.weeklyLimit ?? undefined,
          clientCompany: c.clientCompany ?? undefined,
        },
      });
      updated++;
    }

    return NextResponse.json({ ok: true, updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[sync/contracts] ERROR:", message, err);
    return NextResponse.json({ error: "Failed to sync contracts", detail: message }, { status: 500 });
  }
});
