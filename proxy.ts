import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE, verifySessionCookieValue } from "@/lib/session";
import { ME_COOKIE, verifyMeCookie } from "@/lib/me-session";

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (
    pathname === "/admin/login" ||
    pathname === "/api/admin/login" ||
    pathname === "/api/admin/logout" ||
    pathname === "/me/login" ||
    pathname === "/api/me/login" ||
    pathname === "/api/me/logout"
  ) {
    return NextResponse.next();
  }

  const adminPath =
    pathname === "/" ||
    pathname === "/api/accounts" ||
    pathname === "/api/alerts" ||
    pathname.startsWith("/admin/") ||
    pathname.startsWith("/api/admin/");

  if (adminPath) {
    const ok = await verifySessionCookieValue(req.cookies.get(ADMIN_COOKIE.name)?.value);
    if (ok) return NextResponse.next();
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/admin/login", req.url));
  }

  if (pathname === "/me" || pathname.startsWith("/me/")) {
    const parsed = await verifyMeCookie(req.cookies.get(ME_COOKIE.name)?.value);
    if (parsed) return NextResponse.next();
    return NextResponse.redirect(new URL("/me/login", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/admin/:path*",
    "/api/admin/:path*",
    "/api/accounts",
    "/api/alerts",
    "/me",
    "/me/:path*",
  ],
};
