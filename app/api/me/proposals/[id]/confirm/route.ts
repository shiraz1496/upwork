import { NextRequest } from "next/server";
import { requireDeveloper } from "@/lib/me-auth";
import { NoteBody, confirmSubmission, serializeDraft } from "@/lib/proposals/drafts";
import { proposalRouteError, readJson } from "@/lib/proposals/http";

// The developer records that they submitted this proposal on upwork.com themselves.
// Self-reported → SUBMISSION_UNVERIFIED. This never submits anything to Upwork.
export async function POST(req: NextRequest, ctx: RouteContext<"/api/me/proposals/[id]/confirm">) {
  try {
    const member = await requireDeveloper();
    const { id } = await ctx.params;
    const { note } = NoteBody.parse(await readJson(req));
    const draft = await confirmSubmission(member, id, note);
    return Response.json({ proposal: serializeDraft(draft) });
  } catch (err) {
    return proposalRouteError(err);
  }
}
