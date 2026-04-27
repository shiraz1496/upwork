import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ADMIN_COOKIE, buildSessionCookieValue } from "@/lib/session";

const Body = z.object({ password: z.string().min(1) });

export async function POST(req: NextRequest) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    return NextResponse.json({ error: "server misconfigured" }, { status: 500 });
  }

  let body: { password: string };
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  if (body.password !== expected) {
    return NextResponse.json({ error: "wrong password" }, { status: 401 });
  }

  const cookieValue = await buildSessionCookieValue();
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
