import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { ADMIN_COOKIE, verifySessionCookieValue } from "@/lib/session";

export class AdminAuthError extends Error {}

export async function requireAdmin() {
  const jar = await cookies();
  const raw = jar.get(ADMIN_COOKIE.name)?.value;
  if (!(await verifySessionCookieValue(raw))) {
    throw new AdminAuthError("unauthenticated");
  }

  const admin = await prisma.teamMember.findFirst({
    where: { role: "admin", status: "active" },
    orderBy: { createdAt: "asc" },
  });
  if (!admin) throw new AdminAuthError("no admin member");

  return admin;
}

export function adminErrorResponse(err: unknown) {
  if (err instanceof AdminAuthError) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  console.error("[admin]", err);
  return Response.json({ error: "internal" }, { status: 500 });
}
