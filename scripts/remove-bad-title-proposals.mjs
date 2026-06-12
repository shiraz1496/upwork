/**
 * remove-bad-title-proposals.mjs
 *
 * Deletes proposal rows whose jobTitle is actually a button/nav label
 * that leaked in through the contract scraper (e.g. "Submit work for payment",
 * "Leave feedback", "Send a message").
 *
 * Run with:
 *   node scripts/remove-bad-title-proposals.mjs
 *
 * Pass --dry-run to preview without deleting:
 *   node scripts/remove-bad-title-proposals.mjs --dry-run
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg(process.env.DIRECT_URL),
});
const isDryRun = process.argv.includes("--dry-run");

const BAD_TITLES = [
  "send a message", "submit work for payment", "leave feedback",
  "view offer", "accept offer", "decline offer", "end contract",
  "give a bonus", "fund milestone", "request an extension",
  "view contract", "start contract", "review contract", "pay bonus",
  "make a payment", "pay milestone", "release escrow", "release payment",
  "release funds", "approve", "add milestone", "view invoice",
  "schedule a rate increase", "more options", "see timesheet",
  "propose new contract",
];

async function main() {
  if (isDryRun) console.log("[DRY RUN] No changes will be made.\n");

  const matches = await prisma.proposal.findMany({
    where: {
      OR: BAD_TITLES.map((t) => ({
        jobTitle: { equals: t, mode: "insensitive" },
      })),
    },
    select: {
      id: true, jobTitle: true, clientCompany: true, hiredAt: true,
      contractStatus: true, accountId: true,
    },
  });

  console.log(`Found ${matches.length} proposal row(s) with bad titles.`);

  if (matches.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  for (const p of matches) {
    console.log(
      `  ${p.id}  jobTitle="${p.jobTitle}"  client="${p.clientCompany ?? "—"}"  hiredAt=${p.hiredAt?.toISOString() ?? "—"}  status=${p.contractStatus ?? "—"}`
    );
  }

  if (isDryRun) {
    console.log("\n[DRY RUN] Re-run without --dry-run to delete.");
    return;
  }

  const { count } = await prisma.proposal.deleteMany({
    where: { id: { in: matches.map((p) => p.id) } },
  });

  console.log(`\nDeleted ${count} row(s).`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
