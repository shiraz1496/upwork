import { NextRequest, NextResponse } from "next/server";
import { requireDeveloper } from "@/lib/me-auth";
import { AuthError, ForbiddenError } from "@/lib/member-auth";
import { memberAccount } from "@/lib/dashboard-feed";
import { completeAuth } from "@/lib/upwork/connection";
import { UpworkError } from "@/lib/upwork/errors";
import { logError } from "@/lib/log";

// Upwork redirects the browser here after consent. Always answers with a redirect back
// to the bidder dashboard carrying a short status code (never tokens or error details).
export async function GET(req: NextRequest) {
  const back = (result: string) => NextResponse.redirect(new URL(`/me?upwork=${result}`, req.url));

  let member: { id: string; name: string };
  try {
    member = await requireDeveloper();
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.redirect(new URL("/me/login", req.url));
    throw err;
  }

  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  if (searchParams.get("error")) return back("denied");
  if (!code || !state) return back("invalid");

  try {
    await completeAuth(member.id, { code, state });
    // Attach the bidder's dashboard account to the Upwork account they just connected.
    await memberAccount(member);
    return back("connected");
  } catch (err) {
    if (err instanceof ForbiddenError) return back("account_in_use");
    if (err instanceof UpworkError) return back(err.code);
    logError("upwork callback", err);
    return back("error");
  }
}
