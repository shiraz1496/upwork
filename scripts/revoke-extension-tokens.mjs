/**
 * revoke-extension-tokens.mjs
 *
 * Sets revokedAt=now() on every ExtensionToken that isn't revoked yet
 * (MCP migration, Phase C). The app already refuses extension-token auth;
 * this makes the tokens dead in the data too.
 *
 * Dry run first:
 *   DATABASE_URL=... node scripts/revoke-extension-tokens.mjs --dry-run
 *   DATABASE_URL=... node scripts/revoke-extension-tokens.mjs
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}
const dryRun = process.argv.includes("--dry-run");
const host = url.slice(url.lastIndexOf("@") + 1).split("/")[0];
const isLocal = host.startsWith("localhost") || host.startsWith("127.0.0.1");
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url, ssl: isLocal ? false : { rejectUnauthorized: false } }),
});

try {
  console.log(`Target database: ${host}${dryRun ? " (dry run)" : ""}`);
  const active = await prisma.extensionToken.count({ where: { revokedAt: null } });
  console.log(`Active extension tokens: ${active}`);
  if (!dryRun && active > 0) {
    const { count } = await prisma.extensionToken.updateMany({
      where: { revokedAt: null },
      data: { revokedAt: new Date() },
    });
    console.log(`Revoked ${count} token(s).`);
  }
} finally {
  await prisma.$disconnect();
}
