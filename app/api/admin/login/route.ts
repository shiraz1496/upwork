import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE, buildSessionCookieValue } from "@/lib/session";
import { LoginBody, authenticateMember } from "@/lib/login";

export async function POST(req: NextRequest) {
  let body: { email: string; password: string };
  try {
    body = LoginBody.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const admin = await authenticateMember(body.email, body.password, "admin");
  if (!admin) {
    return NextResponse.json({ error: "wrong email or password" }, { status: 401 });
  }

  const cookieValue = await buildSessionCookieValue(admin);
  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: ADMIN_COOKIE.name,
    value: cookieValue,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ADMIN_COOKIE.maxAge,
  });
  return res;
}
