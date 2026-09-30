import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { ADMIN_COOKIE, verifySessionCookieValue } from "@/lib/session";
import { logError } from "@/lib/log";

export class AdminAuthError extends Error {}

// Resolves the admin identified by the session cookie (not "oldest admin").
// Rejects if the member is gone, inactive, no longer admin, or sessionVersion was bumped.
export async function requireAdmin() {
  const jar = await cookies();
  const session = await verifySessionCookieValue(jar.get(ADMIN_COOKIE.name)?.value);
  if (!session) throw new AdminAuthError("unauthenticated");

  const admin = await prisma.teamMember.findUnique({ where: { id: session.memberId } });
  if (
    !admin ||
    admin.role !== "admin" ||
    admin.status !== "active" ||
    admin.sessionVersion !== session.sessionVersion
  ) {
    throw new AdminAuthError("unauthenticated");
  }

  return admin;
}

export function adminErrorResponse(err: unknown) {
  if (err instanceof AdminAuthError) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  // Client mistakes are not server errors.
  if (err instanceof SyntaxError) {
    return Response.json({ error: "invalid", detail: "body must be JSON" }, { status: 400 });
  }
  const code = (err as { code?: unknown } | null)?.code;
  if (code === "P2002") return Response.json({ error: "conflict", detail: "already exists" }, { status: 409 });
  if (code === "P2025") return Response.json({ error: "not found" }, { status: 404 });
  logError("admin", err);
  return Response.json({ error: "internal" }, { status: 500 });
}
