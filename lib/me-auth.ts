import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { AuthError, ForbiddenError, authErrorResponse } from "@/lib/member-auth";
import { ME_COOKIE, verifyMeCookie } from "@/lib/me-session";

// Resolves the developer (role=bidder) from the session cookie only.
// The raw Bearer-token fallback (extension path) is gone.
// `_req` is kept so existing call sites `resolveMeSession(req)` keep compiling.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function resolveMeSession(_req?: Request) {
  const jar = await cookies();
  const session = await verifyMeCookie(jar.get(ME_COOKIE.name)?.value);
  if (!session) throw new AuthError("unauthenticated");

  const member = await prisma.teamMember.findUnique({ where: { id: session.memberId } });
  if (!member) throw new AuthError("unauthenticated");
  if (member.status !== "active") throw new AuthError("member_inactive");
  if (member.role !== "bidder" || member.sessionVersion !== session.sessionVersion) {
    throw new AuthError("session_expired");
  }
  return { member };
}

export async function requireDeveloper() {
  const { member } = await resolveMeSession();
  return member;
}

// Isolation guard: a developer may only touch rows they own.
export function assertOwns(member: { id: string }, resourceMemberId: string | null | undefined) {
  if (!resourceMemberId || resourceMemberId !== member.id) throw new ForbiddenError();
}

export { authErrorResponse };
