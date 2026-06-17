/**
 * seed-blocked-titles.mjs
 *
 * Seeds the BlockedTitle table with the strings that used to live in the
 * hardcoded BAD_TITLES arrays inside the sync routes and the extension.
 *
 * Idempotent: existing patterns are skipped (unique constraint on `pattern`).
 *
 * Run with:
 *   npm run db:seed-blocked-titles
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg(process.env.DIRECT_URL || process.env.DATABASE_URL),
});

// Shared between proposals + extension. These titles appear in the UI chrome
// of every Upwork page so we always want them filtered.
const SHARED_TITLES = [
  "open job in a new window", "open job", "my proposals", "my stats",
  "find work", "saved jobs", "send a proposal", "submit a proposal",
  "learn more", "upgrade", "contract-to-hire", "similar jobs",
  "apply now", "save job", "view profile", "sign in", "log in",
  "messages", "help", "settings", "view job posting", "view job",
  "proposal details", "job details", "insights",
  "search for jobs", "manage your profile", "browse jobs", "find a job",
  "post a job", "manage finances", "reports",
];

// Proposal-page-specific chrome (the proposals sync route had these on top
// of the shared set).
const PROPOSAL_ONLY_TITLES = [
  "send a message", "submit work for payment", "leave feedback",
  "view offer", "accept offer", "decline offer", "end contract",
  "give a bonus", "fund milestone", "request an extension",
  "view contract", "start contract", "review contract", "pay bonus",
  "job is closed", "viewed by client", "personal note from client",
  "schedule a rate increase", "footer navigation", "freelancer plus",
];

// Contract-page-specific chrome (these would over-filter proposal titles
// if applied globally — e.g. "release escrow" is a button on the contract
// page, not a real job title).
const CONTRACT_ONLY_TITLES = [
  "send a message", "submit work for payment", "leave feedback",
  "view offer", "accept offer", "decline offer", "end contract",
  "give a bonus", "fund milestone", "request an extension",
  "view contract", "start contract", "review contract", "pay bonus",
  "make a payment", "pay milestone", "release escrow", "release payment",
  "release funds", "approve", "add milestone", "view invoice",
  "schedule a rate increase", "more options", "see timesheet",
  "propose new contract",
];

async function seed(scope, patterns) {
  let inserted = 0;
  let skipped = 0;
  for (const raw of patterns) {
    const pattern = raw.toLowerCase().trim();
    if (!pattern) continue;
    try {
      await prisma.blockedTitle.create({ data: { pattern, scope, active: true } });
      inserted += 1;
    } catch (err) {
      if (err?.code === "P2002") {
        skipped += 1;
      } else {
        throw err;
      }
    }
  }
  return { inserted, skipped };
}

async function main() {
  const shared = await seed("all", SHARED_TITLES);
  const proposals = await seed("proposals", PROPOSAL_ONLY_TITLES);
  const contracts = await seed("contracts", CONTRACT_ONLY_TITLES);

  console.log("Seeded BlockedTitle:");
  console.log(`  scope=all        inserted=${shared.inserted}  skipped=${shared.skipped}`);
  console.log(`  scope=proposals  inserted=${proposals.inserted}  skipped=${proposals.skipped}`);
  console.log(`  scope=contracts  inserted=${contracts.inserted}  skipped=${contracts.skipped}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
