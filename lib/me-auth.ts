import { cookies } from "next/headers";
import type { TeamMember } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveExtensionToken, AuthError, authErrorResponse } from "@/lib/member-auth";
import { ME_COOKIE, verifyMeCookie } from "@/lib/me-session";

export async function resolveMeSession(req: Request): Promise<{ member: TeamMember }> {
  const jar = await cookies();
  const raw = jar.get(ME_COOKIE.name)?.value;
  const parsed = await verifyMeCookie(raw);
  if (parsed) {
    const member = await prisma.teamMember.findUnique({ where: { id: parsed.memberId } });
    if (!member) throw new AuthError("member_not_found");
    if (member.status !== "active") throw new AuthError("member_inactive");
    return { member };
  }

  const { member } = await resolveExtensionToken(req);
  return { member };
}

export { authErrorResponse };
