// One-shot: creates the initial admin TeamMember and stamps capturedByUserId
// on every existing Snapshot / Proposal / Job / Alert row that lacks it.
// Idempotent — re-running is a no-op.
//
// Run: node --env-file=.env scripts/backfill-attribution.mjs

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const ADMIN_EMAIL = process.env.BACKFILL_ADMIN_EMAIL || "admin@upworkTracker.com";
const ADMIN_NAME = process.env.BACKFILL_ADMIN_NAME || "Osama Shiraz";

const prisma = new PrismaClient({
  adapter: new PrismaPg(process.env.DATABASE_URL),
});

async function main() {
  const admin = await prisma.teamMember.upsert({
    where: { email: ADMIN_EMAIL },
    update: {},
    create: { name: ADMIN_NAME, email: ADMIN_EMAIL, role: "admin", status: "active" },
  });
  console.log(`[backfill] admin member: ${admin.id} (${admin.email})`);

  const snap = await prisma.snapshot.updateMany({
    where: { capturedByUserId: null },
    data: { capturedByUserId: admin.id },
  });

  const props = await prisma.$executeRaw`
    UPDATE "Proposal"
       SET "capturedByUserId" = ${admin.id},
           "capturedAt"       = COALESCE("capturedAt", "createdAt")
     WHERE "capturedByUserId" IS NULL
  `;
  const jobs = await prisma.$executeRaw`
    UPDATE "Job"
       SET "capturedByUserId" = ${admin.id},
           "capturedAt"       = COALESCE("capturedAt", "viewedAt")
     WHERE "capturedByUserId" IS NULL
  `;
  const alerts = await prisma.$executeRaw`
    UPDATE "Alert"
       SET "capturedByUserId" = ${admin.id},
           "capturedAt"       = COALESCE("capturedAt", "notifiedAt")
     WHERE "capturedByUserId" IS NULL
  `;

  console.log(`[backfill] snapshots: ${snap.count}`);
  console.log(`[backfill] proposals: ${props}`);
  console.log(`[backfill] jobs:      ${jobs}`);
  console.log(`[backfill] alerts:    ${alerts}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
