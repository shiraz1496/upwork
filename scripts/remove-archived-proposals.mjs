/**
 * remove-archived-proposals.mjs
 *
 * Deletes all proposals with section "Archived proposals" or
 * "Archived interviews" from the database.
 *
 * Run with:
 *   node scripts/remove-archived-proposals.mjs
 *
 * Pass --dry-run to preview without deleting:
 *   node scripts/remove-archived-proposals.mjs --dry-run
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg(process.env.DATABASE_URL),
});
const isDryRun = process.argv.includes("--dry-run");

const ARCHIVED_SECTIONS = ["Archived proposals", "Archived interviews"];

async function main() {
  console.log(isDryRun ? "[DRY RUN] No changes will be made.\n" : "");

  const count = await prisma.proposal.count({
    where: { section: { in: ARCHIVED_SECTIONS } },
  });

  console.log(`Found ${count} archived proposal(s) to delete.`);

  if (count === 0) {
    console.log("Nothing to do.");
    return;
  }

  if (isDryRun) {
    const samples = await prisma.proposal.findMany({
      where: { section: { in: ARCHIVED_SECTIONS } },
      select: { id: true, jobTitle: true, section: true, createdAt: true },
      take: 10,
    });
    console.log("\nSample rows that would be deleted:");
    for (const p of samples) {
      console.log(`  [${p.section}] ${p.jobTitle || "(no title)"} — ${p.id}`);
    }
    if (count > 10) console.log(`  ... and ${count - 10} more.`);
    return;
  }

  const { count: deleted } = await prisma.proposal.deleteMany({
    where: { section: { in: ARCHIVED_SECTIONS } },
  });

  console.log(`Deleted ${deleted} archived proposal(s).`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
