import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { ADMIN_COOKIE, verifySessionCookieValue } from "@/lib/session";

// Clears the cookie AND bumps sessionVersion, so a copy of the cookie stops working too
// (it signs the member out everywhere).
export async function POST() {
  const session = await verifySessionCookieValue((await cookies()).get(ADMIN_COOKIE.name)?.value);
  if (session) {
    await prisma.teamMember.updateMany({
      where: { id: session.memberId, sessionVersion: session.sessionVersion },
      data: { sessionVersion: { increment: 1 } },
    });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set({ name: ADMIN_COOKIE.name, value: "", path: "/", maxAge: 0 });
  return res;
}
