// Reverts the backfill-attribution.mjs script.
// Finds the placeholder admin member created by the backfill
// (email: admin@upworkTracker.com) and sets capturedByUserId = NULL
// on every Proposal / Snapshot / Job / Alert row that was stamped with it.
//
// Safe to run against live DB — only touches rows owned by the placeholder.
// Idempotent — re-running is a no-op once nulled out.
//
// Run: node --env-file=.env scripts/revert-backfill-attribution.mjs

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const BACKFILL_EMAIL = process.env.BACKFILL_ADMIN_EMAIL || "admin@upworkTracker.com";

const prisma = new PrismaClient({
  adapter: new PrismaPg(process.env.DATABASE_URL),
});

async function main() {
  const admin = await prisma.teamMember.findUnique({ where: { email: BACKFILL_EMAIL } });

  if (!admin) {
    console.log(`[revert] No member found with email ${BACKFILL_EMAIL} — nothing to do.`);
    return;
  }

  console.log(`[revert] Found backfill member: ${admin.id} (${admin.name} / ${admin.email})`);

  const snapshots = await prisma.$executeRaw`
    UPDATE "Snapshot"
       SET "capturedByUserId" = NULL
     WHERE "capturedByUserId" = ${admin.id}
  `;

  const proposals = await prisma.$executeRaw`
    UPDATE "Proposal"
       SET "capturedByUserId" = NULL
     WHERE "capturedByUserId" = ${admin.id}
  `;

  const jobs = await prisma.$executeRaw`
    UPDATE "Job"
       SET "capturedByUserId" = NULL
     WHERE "capturedByUserId" = ${admin.id}
  `;

  const alerts = await prisma.$executeRaw`
    UPDATE "Alert"
       SET "capturedByUserId" = NULL
     WHERE "capturedByUserId" = ${admin.id}
  `;

  console.log(`[revert] snapshots nulled: ${snapshots}`);
  console.log(`[revert] proposals nulled: ${proposals}`);
  console.log(`[revert] jobs nulled:      ${jobs}`);
  console.log(`[revert] alerts nulled:    ${alerts}`);

  // Remove the placeholder member — it was only created for the backfill.
  await prisma.teamMember.delete({ where: { id: admin.id } });
  console.log(`[revert] Deleted placeholder member ${admin.id}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
