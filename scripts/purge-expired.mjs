/**
 * purge-expired.mjs
 *
 * Removes Upwork-derived (MCP) data that has passed its retention period (handover Phase H).
 * Copying Upwork's data into our database does not exempt it from retention.
 *
 * What it removes:
 *   1. ClientResponse.snippet            — reply preview, once expiresAt has passed (row kept)
 *   2. ProposalDraft.jobDescriptionCache — cached job description, once jobDataExpiresAt has passed
 *   3. FreelancerProfile + Account.connectsBalance of Upwork-connected accounts that were
 *      last read from Upwork more than the retention period ago (re-read on the next refresh)
 *   4. OAuth sign-in state left behind by a "Connect Upwork" that was never finished (> 1 hour)
 *
 * What it never touches (the team's own content): cover letters, bids, submitted snapshots,
 * proposal status history, coaching notes, the dashboard Proposal and Alert rows, and
 * anything captured by the old extension.
 *
 * Run by hand (nothing schedules it). Always do a dry run first:
 *   DATABASE_URL=... node scripts/purge-expired.mjs --dry-run
 *   DATABASE_URL=... node scripts/purge-expired.mjs
 */

import { fileURLToPath } from "node:url";

// Must match MCP_DATA_TTL_DAYS in lib/retention.ts (a test checks this).
export const MCP_DATA_TTL_DAYS = 30;
const ABANDONED_OAUTH_MS = 60 * 60 * 1000;

/**
 * @param {import("@prisma/client").PrismaClient} prisma
 * @param {{ dryRun?: boolean, now?: Date, ttlDays?: number }} [opts]
 */
export async function purgeExpired(prisma, opts = {}) {
  const now = opts.now ?? new Date();
  const dryRun = opts.dryRun ?? false;
  const ttlDays = opts.ttlDays ?? MCP_DATA_TTL_DAYS;
  const profileCutoff = new Date(now.getTime() - ttlDays * 24 * 60 * 60 * 1000);
  const oauthCutoff = new Date(now.getTime() - ABANDONED_OAUTH_MS);

  // 1. Reply previews past their expiry.
  const snippetWhere = { snippet: { not: null }, expiresAt: { lte: now } };
  // 2. Cached job descriptions past their expiry.
  const jobCacheWhere = { jobDescriptionCache: { not: null }, jobDataExpiresAt: { lte: now } };
  // 3. Profiles read from Upwork: only accounts that belong to an Upwork connection.
  const connected = await prisma.upworkConnection.findMany({
    where: { upworkAccountId: { not: null } },
    select: { upworkAccountId: true },
  });
  const upworkIds = connected.map((c) => c.upworkAccountId);
  const staleProfiles = await prisma.freelancerProfile.findMany({
    where: { capturedAt: { lt: profileCutoff }, account: { freelancerId: { in: upworkIds } } },
    select: { id: true, accountId: true },
  });
  // 4. Abandoned sign-in state.
  const oauthWhere = { oauthState: { not: null }, updatedAt: { lt: oauthCutoff } };

  const counts = {
    replySnippets: await prisma.clientResponse.count({ where: snippetWhere }),
    jobDescriptionCaches: await prisma.proposalDraft.count({ where: jobCacheWhere }),
    upworkProfiles: staleProfiles.length,
    abandonedSignIns: await prisma.upworkConnection.count({ where: oauthWhere }),
  };
  if (dryRun) return { dryRun: true, ...counts };

  await prisma.$transaction([
    prisma.clientResponse.updateMany({ where: snippetWhere, data: { snippet: null } }),
    prisma.proposalDraft.updateMany({ where: jobCacheWhere, data: { jobDescriptionCache: null } }),
    prisma.freelancerProfile.deleteMany({ where: { id: { in: staleProfiles.map((p) => p.id) } } }),
    prisma.account.updateMany({
      where: { id: { in: staleProfiles.map((p) => p.accountId) } },
      data: { connectsBalance: null },
    }),
    prisma.upworkConnection.updateMany({ where: oauthWhere, data: { oauthState: null, oauthCodeVerifier: null } }),
  ]);
  return { dryRun: false, ...counts };
}

// ---- command line ----
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }
  const dryRun = process.argv.includes("--dry-run");
  const host = url.slice(url.lastIndexOf("@") + 1).split("/")[0];
  const isLocal = host.startsWith("localhost") || host.startsWith("127.0.0.1");

  const { PrismaClient } = await import("@prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url, ssl: isLocal ? false : { rejectUnauthorized: false } }),
  });

  try {
    console.log(`Target database: ${host}${dryRun ? " (dry run — nothing will be changed)" : ""}`);
    console.log(`Retention: ${MCP_DATA_TTL_DAYS} days`);
    const r = await purgeExpired(prisma, { dryRun });
    const verb = dryRun ? "would be removed" : "removed";
    console.log(`  reply previews ${verb}:          ${r.replySnippets}`);
    console.log(`  job description caches ${verb}:  ${r.jobDescriptionCaches}`);
    console.log(`  Upwork profiles ${verb}:         ${r.upworkProfiles}`);
    console.log(`  abandoned sign-ins cleared:${dryRun ? " (would be)" : ""}      ${r.abandonedSignIns}`);
  } finally {
    await prisma.$disconnect();
  }
}
