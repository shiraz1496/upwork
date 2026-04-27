import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveExtensionToken, authErrorResponse } from "@/lib/member-auth";
import { ME_COOKIE, buildMeCookieValue } from "@/lib/me-session";

const Body = z.object({ token: z.string().min(1) });

export async function POST(req: NextRequest) {
  try {
    const { token } = Body.parse(await req.json());
    const fakeReq = new Request("http://local/verify", {
      headers: { authorization: `Bearer ${token}` },
    });
    const { member } = await resolveExtensionToken(fakeReq);

    const cookieValue = await buildMeCookieValue(member.id);
    const res = NextResponse.json({
      ok: true,
      member: { id: member.id, name: member.name, email: member.email, role: member.role },
    });
    res.cookies.set({
      name: ME_COOKIE.name,
      value: cookieValue,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: ME_COOKIE.maxAge,
    });
    return res;
  } catch (err) {
    return authErrorResponse(err);
  }
}
