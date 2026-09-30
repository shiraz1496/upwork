import { NextRequest } from "next/server";
import { requireDeveloper } from "@/lib/me-auth";
import { serializeDraft, verifySubmission } from "@/lib/proposals/drafts";
import { proposalRouteError } from "@/lib/proposals/http";

// User-triggered check of a recorded submission against Upwork's own proposal list (read only).
// verification: "verified" | "not_found" | "disabled" (integration off → nothing changes).
export async function POST(_req: NextRequest, ctx: RouteContext<"/api/me/proposals/[id]/verify">) {
  try {
    const member = await requireDeveloper();
    const { id } = await ctx.params;
    const { verification, draft } = await verifySubmission(member, id);
    return Response.json({ verification, proposal: serializeDraft(draft) });
  } catch (err) {
    return proposalRouteError(err);
  }
}
