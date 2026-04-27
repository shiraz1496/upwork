import { NextResponse } from "next/server";
import { ME_COOKIE } from "@/lib/me-session";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set({ name: ME_COOKIE.name, value: "", path: "/", maxAge: 0 });
  return res;
}
