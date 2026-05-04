import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

function parseDatabaseUrl(url: string) {
  // Use last @ as host delimiter so passwords containing @ are handled correctly
  const withoutScheme = url.replace(/^(postgresql|postgres):\/\//, "");
  const lastAt = withoutScheme.lastIndexOf("@");
  const userInfo = withoutScheme.slice(0, lastAt);
  const rest = withoutScheme.slice(lastAt + 1);

  const colonIdx = userInfo.indexOf(":");
  const user = userInfo.slice(0, colonIdx);
  const password = userInfo.slice(colonIdx + 1);

  const [hostPort, dbAndParams = "postgres"] = rest.split("/");
  const [database] = dbAndParams.split("?");
  const [host, port = "5432"] = hostPort.split(":");

  return { user, password, host, port: parseInt(port), database };
}

function createPrismaClient() {
  const { user, password, host, port, database } = parseDatabaseUrl(
    process.env.DATABASE_URL!
  );
  const pool = new pg.Pool({
    user,
    password,
    host,
    port,
    database,
    ssl: { rejectUnauthorized: false },
  });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
