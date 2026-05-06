// Assigns Account.primaryOwnerId based on which bidder has captured the most
// activity (proposals + snapshots + alerts) on that account, ignoring admins.
//
// By default only writes to accounts whose primaryOwnerId is currently null.
// Pass --force to overwrite existing assignments too.
//
// Run: node --env-file=.env scripts/assign-account-owners.mjs [--force]

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const force = process.argv.includes("--force");

const prisma = new PrismaClient({
  adapter: new PrismaPg(process.env.DATABASE_URL),
});

async function main() {
  const bidders = await prisma.teamMember.findMany({
    where: { role: "bidder" },
    select: { id: true, name: true },
  });
  const bidderIds = new Set(bidders.map((b) => b.id));
  const nameById = new Map(bidders.map((b) => [b.id, b.name]));

  if (bidderIds.size === 0) {
    console.log("[assign-owners] No bidders found — nothing to do.");
    return;
  }

  const accounts = await prisma.account.findMany({
    select: { id: true, name: true, primaryOwnerId: true },
  });

  console.log(
    `[assign-owners] ${accounts.length} accounts, ${bidderIds.size} bidders, force=${force}`,
  );

  const tally = (rows) => {
    const counts = new Map();
    for (const r of rows) {
      const uid = r.capturedByUserId;
      if (!uid || !bidderIds.has(uid)) continue;
      counts.set(uid, (counts.get(uid) ?? 0) + 1);
    }
    return counts;
  };

  let assigned = 0;
  let skipped = 0;
  let unowned = 0;

  for (const acc of accounts) {
    if (!force && acc.primaryOwnerId) {
      skipped++;
      continue;
    }

    const [props, snaps, alerts] = await Promise.all([
      prisma.proposal.findMany({
        where: { accountId: acc.id, capturedByUserId: { not: null } },
        select: { capturedByUserId: true },
      }),
      prisma.snapshot.findMany({
        where: { accountId: acc.id, capturedByUserId: { not: null } },
        select: { capturedByUserId: true },
      }),
      prisma.alert.findMany({
        where: { accountId: acc.id, capturedByUserId: { not: null } },
        select: { capturedByUserId: true },
      }),
    ]);

    const counts = new Map();
    for (const map of [tally(props), tally(snaps), tally(alerts)]) {
      for (const [uid, n] of map) counts.set(uid, (counts.get(uid) ?? 0) + n);
    }

    if (counts.size === 0) {
      unowned++;
      console.log(`  · ${acc.name}: no bidder captures — left unowned`);
      continue;
    }

    let topId = null;
    let topN = -1;
    for (const [uid, n] of counts) {
      if (n > topN) { topN = n; topId = uid; }
    }

    if (acc.primaryOwnerId === topId) {
      skipped++;
      continue;
    }

    await prisma.account.update({
      where: { id: acc.id },
      data: { primaryOwnerId: topId },
    });
    assigned++;
    console.log(`  ✓ ${acc.name} → ${nameById.get(topId)} (${topN} captures)`);
  }

  console.log(
    `[assign-owners] done — assigned ${assigned}, unchanged ${skipped}, unowned ${unowned}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
