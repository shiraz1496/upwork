import { NextRequest } from "next/server";
import { z } from "zod";
import { requireDeveloper } from "@/lib/me-auth";
import { proposalRouteError, readJson } from "@/lib/proposals/http";
import { linkResponse, serializeResponse } from "@/lib/responses";

const Body = z.object({ draftId: z.string().min(1).max(64).nullable() });

// Manual association: the developer links (or unlinks) a response to one of their own proposals.
export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/me/responses/[id]">) {
  try {
    const member = await requireDeveloper();
    const { id } = await ctx.params;
    const { draftId } = Body.parse(await readJson(req));
    const response = await linkResponse(member, id, draftId);
    return Response.json({ response: serializeResponse(response) });
  } catch (err) {
    return proposalRouteError(err);
  }
}
