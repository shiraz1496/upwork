// Finds the admin member Osama Shiraz (role: admin) and DELETES every
// Proposal / Snapshot / Job / Alert row that was captured by him.
//
// ONLY deletes rows where capturedByUserId = Osama's ID.
// Does NOT delete the member account itself.
// Idempotent — safe to re-run.
//
// Run: node --env-file=.env scripts/null-admin-attribution.mjs

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg(process.env.DATABASE_URL),
});

async function main() {
  // Double safety: must be role=admin AND name contains "Osama"
  const admin = await prisma.teamMember.findFirst({
    where: {
      role: "admin",
      name: { contains: "Osama", mode: "insensitive" },
    },
  });

  if (!admin) {
    console.log(`[delete-admin-data] No admin member matching "Osama" found — nothing to do.`);
    return;
  }

  console.log(`[delete-admin-data] Found admin: ${admin.id} (${admin.name} / ${admin.email})`);
  console.log(`[delete-admin-data] Previewing rows to delete...`);

  const [proposalCount] = await prisma.$queryRaw`
    SELECT COUNT(*) AS count FROM "Proposal" WHERE "capturedByUserId" = ${admin.id}
  `;
  const [snapshotCount] = await prisma.$queryRaw`
    SELECT COUNT(*) AS count FROM "Snapshot" WHERE "capturedByUserId" = ${admin.id}
  `;
  const [jobCount] = await prisma.$queryRaw`
    SELECT COUNT(*) AS count FROM "Job" WHERE "capturedByUserId" = ${admin.id}
  `;
  const [alertCount] = await prisma.$queryRaw`
    SELECT COUNT(*) AS count FROM "Alert" WHERE "capturedByUserId" = ${admin.id}
  `;

  console.log(`[delete-admin-data]   Proposals : ${proposalCount.count}`);
  console.log(`[delete-admin-data]   Snapshots : ${snapshotCount.count}`);
  console.log(`[delete-admin-data]   Jobs      : ${jobCount.count}`);
  console.log(`[delete-admin-data]   Alerts    : ${alertCount.count}`);

  const total =
    Number(proposalCount.count) +
    Number(snapshotCount.count) +
    Number(jobCount.count) +
    Number(alertCount.count);

  if (total === 0) {
    console.log(`[delete-admin-data] Nothing to delete — already clean.`);
    return;
  }

  console.log(`[delete-admin-data] Deleting ${total} rows...`);

  const proposals = await prisma.$executeRaw`
    DELETE FROM "Proposal" WHERE "capturedByUserId" = ${admin.id}
  `;
  const snapshots = await prisma.$executeRaw`
    DELETE FROM "Snapshot" WHERE "capturedByUserId" = ${admin.id}
  `;
  const jobs = await prisma.$executeRaw`
    DELETE FROM "Job" WHERE "capturedByUserId" = ${admin.id}
  `;
  const alerts = await prisma.$executeRaw`
    DELETE FROM "Alert" WHERE "capturedByUserId" = ${admin.id}
  `;

  console.log(`[delete-admin-data] Done.`);
  console.log(`[delete-admin-data]   proposals deleted : ${proposals}`);
  console.log(`[delete-admin-data]   snapshots deleted : ${snapshots}`);
  console.log(`[delete-admin-data]   jobs deleted      : ${jobs}`);
  console.log(`[delete-admin-data]   alerts deleted    : ${alerts}`);
  console.log(`[delete-admin-data] Member ${admin.name} (${admin.id}) was NOT deleted.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
