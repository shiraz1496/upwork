import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin, adminErrorResponse } from "@/lib/admin-auth";

const PatchBody = z.object({
  isDisabled: z.boolean(),
  disabledReason: z.string().max(300).optional().nullable(),
});

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/admin/accounts/[id]">) {
  try {
    await requireAdmin();
    const { id } = await ctx.params;
    const body = PatchBody.parse(await req.json());

    const account = await prisma.account.findUnique({ where: { id } });
    if (!account) return Response.json({ error: "not found" }, { status: 404 });

    const updated = await prisma.account.update({
      where: { id },
      data: {
        isDisabled: body.isDisabled,
        disabledReason: body.isDisabled ? (body.disabledReason ?? null) : null,
      },
    });

    return Response.json({ ok: true, account: { id: updated.id, isDisabled: updated.isDisabled, disabledReason: updated.disabledReason } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return Response.json({ error: "invalid", issues: err.issues }, { status: 400 });
    }
    return adminErrorResponse(err);
  }
}
