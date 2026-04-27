import { NextResponse } from "next/server";
import { ADMIN_COOKIE } from "@/lib/session";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set({ name: ADMIN_COOKIE.name, value: "", path: "/", maxAge: 0 });
  return res;
}
