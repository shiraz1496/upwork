/**
 * set-password.mjs
 *
 * Sets (or resets) a team member's login password by email. Also bootstraps the
 * first admin on a fresh database with --create.
 *
 * Setting a password bumps sessionVersion, which logs the member out everywhere.
 *
 * Run with an explicit DATABASE_URL so you always know which DB you're writing to:
 *   DATABASE_URL=postgresql://upwork:upwork@localhost:5433/upwork \
 *     node scripts/set-password.mjs --email you@example.com
 *
 *   # first admin on an empty DB
 *   DATABASE_URL=... node scripts/set-password.mjs --email you@example.com --create --name "Your Name" --role admin
 *
 * The password is prompted for (not passed as an argument) so it doesn't land in shell history.
 */

import { randomBytes, scryptSync } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Must match hashPassword() in lib/crypto.ts.
function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const email = arg("email")?.trim().toLowerCase();
const create = process.argv.includes("--create");
const name = arg("name");
const role = arg("role") ?? "bidder";

if (!email) {
  console.error("Usage: node scripts/set-password.mjs --email <email> [--create --name <name> --role admin|bidder]");
  process.exit(1);
}
if (!["admin", "bidder"].includes(role)) {
  console.error("--role must be admin or bidder");
  process.exit(1);
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const host = url.slice(url.lastIndexOf("@") + 1).split("/")[0];
const rl = createInterface({ input: process.stdin, output: process.stdout });
console.log(`Target database: ${host}`);
const password = await rl.question("New password (min 8 chars): ");
rl.close();
if (password.length < 8) {
  console.error("Password must be at least 8 characters.");
  process.exit(1);
}

const isLocal = host.startsWith("localhost") || host.startsWith("127.0.0.1");
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url, ssl: isLocal ? false : { rejectUnauthorized: false } }),
});

try {
  const existing = await prisma.teamMember.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
  });
  const passwordFields = {
    passwordHash: hashPassword(password),
    passwordSetAt: new Date(),
    sessionVersion: { increment: 1 },
  };

  if (existing) {
    await prisma.teamMember.update({ where: { id: existing.id }, data: passwordFields });
    console.log(`Password set for ${existing.email} (${existing.role}).`);
  } else if (create) {
    if (!name) {
      console.error("--create needs --name");
      process.exit(1);
    }
    const m = await prisma.teamMember.create({
      data: { email, name, role, ...passwordFields, sessionVersion: 0 },
    });
    console.log(`Created ${m.email} (${m.role}) with password.`);
  } else {
    console.error(`No member with email ${email}. Add --create --name "<name>" to create one.`);
    process.exit(1);
  }
} finally {
  await prisma.$disconnect();
}
