import { NextRequest } from "next/server";
import { requireDeveloper } from "@/lib/me-auth";
import { UpdateDraftBody, deleteDraft, serializeDraft, updateDraft } from "@/lib/proposals/drafts";
import { proposalRouteError, readJson } from "@/lib/proposals/http";

// Edit a draft and/or move it DRAFT ↔ READY. Submission is recorded via /confirm.
export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/me/proposals/[id]">) {
  try {
    const member = await requireDeveloper();
    const { id } = await ctx.params;
    const body = UpdateDraftBody.parse(await readJson(req));
    const draft = await updateDraft(member, id, body);
    return Response.json({ proposal: serializeDraft(draft) });
  } catch (err) {
    return proposalRouteError(err);
  }
}

export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/me/proposals/[id]">) {
  try {
    const member = await requireDeveloper();
    const { id } = await ctx.params;
    await deleteDraft(member, id);
    return Response.json({ ok: true });
  } catch (err) {
    return proposalRouteError(err);
  }
}
