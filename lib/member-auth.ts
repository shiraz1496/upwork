import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/tokens";
import type { TeamMember } from "@prisma/client";
import { logError } from "@/lib/log";

// TeamMember as returned by the app's Prisma client (passwordHash is omitted globally).
export type SafeMember = Omit<TeamMember, "passwordHash">;

export class AuthError extends Error {
  reason: string;
  constructor(reason: string) {
    super(reason);
    this.reason = reason;
  }
}

export class ForbiddenError extends Error {
  constructor() {
    super("forbidden");
  }
}

export async function resolveExtensionToken(req: Request): Promise<{
  member: SafeMember;
  tokenId: string;
}> {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    throw new AuthError("missing_header");
  }
  const raw = header.slice(7).trim();
  if (!raw) {
    throw new AuthError("empty_token");
  }

  const tokenHash = hashToken(raw);
  const row = await prisma.extensionToken.findUnique({
    where: { tokenHash },
    include: { member: true },
  });

  if (!row) {
    throw new AuthError("unknown_token");
  }
  if (row.revokedAt) {
    throw new AuthError("revoked");
  }
  if (row.member.status !== "active") {
    throw new AuthError("member_inactive");
  }

  prisma.extensionToken
    .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch((e) => logError("member-auth lastUsedAt", e));

  return { member: row.member, tokenId: row.id };
}

export function authErrorResponse(err: unknown): Response {
  if (err instanceof ForbiddenError) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  if (err instanceof AuthError) {
    return Response.json({ error: err.reason }, { status: 401 });
  }
  logError("member-auth", err);
  return Response.json({ error: "internal" }, { status: 500 });
}
