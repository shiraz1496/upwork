import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAttribution, resolveAccount } from "@/lib/attribution";

function parseContractDate(str: string | null | undefined): Date | null {
  if (!str || /^\s*$/.test(str)) return null;
  const cleaned = str.trim();
  const withYear = /\d{4}/.test(cleaned) ? cleaned : `${cleaned} ${new Date().getUTCFullYear()}`;
  // Parse as UTC midnight. `new Date("May 15 2026")` uses the server's local
  // TZ, which silently shifts the stored date by one day when the server runs
  // east of UTC (e.g. PKT). Appending " UTC" pins it to UTC midnight.
  const d = new Date(`${withYear} UTC`);
  if (isNaN(d.getTime())) return null;
  // If the date lands in the future it must be from last year
  if (d.getTime() > Date.now()) d.setUTCFullYear(d.getUTCFullYear() - 1);
  return d;
}

export const POST = withAttribution(async ({ req, member }) => {
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
    let created = 0;
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
        // No matching proposal — create one from the contract data. We don't
        // know jobUrl / cover letter / submission info; only contract fields.
        const newProposal = await prisma.proposal.create({
          data: {
            accountId: account.id,
            jobTitle: c.title,
            clientCompany: c.clientCompany ?? null,
            hiredAt: hiredAt ?? undefined,
            contractEndedAt: contractEndedAt ?? undefined,
            contractStatus: c.status ?? null,
            contractRating: c.rating != null ? Number(c.rating) : null,
            contractBudget: c.budget ?? null,
            contractRate: c.rate ?? null,
            contractWeeklyLimit: c.weeklyLimit ?? null,
            submittedViaExtension: false,
            capturedByUserId: member.id,
            capturedAt: new Date(),
          },
        });
        console.log("[sync/contracts] Created proposal", newProposal.id, "from contract:", JSON.stringify(c.title), "hiredAt:", hiredAt);
        created++;
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

    return NextResponse.json({ ok: true, updated, created });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[sync/contracts] ERROR:", message, err);
    return NextResponse.json({ error: "Failed to sync contracts", detail: message }, { status: 500 });
  }
});
