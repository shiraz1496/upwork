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

// Extension-token auth is refused since the extension was shut down (MCP migration, Phase C).
// Kept as a function so remaining callers (withAttribution routes) fail closed with 401.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function resolveExtensionToken(_req: Request): Promise<{
  member: SafeMember;
  tokenId: string;
}> {
  throw new AuthError("extension_auth_removed");
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
