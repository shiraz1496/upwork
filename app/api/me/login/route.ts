import { NextRequest, NextResponse } from "next/server";
import { ME_COOKIE, buildMeCookieValue } from "@/lib/me-session";
import { LoginBody, authenticateMember } from "@/lib/login";

export async function POST(req: NextRequest) {
  let body: { email: string; password: string };
  try {
    body = LoginBody.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const member = await authenticateMember(body.email, body.password, "bidder");
  if (!member) {
    return NextResponse.json({ error: "wrong email or password" }, { status: 401 });
  }

  const cookieValue = await buildMeCookieValue(member);
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
}
