import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin, adminErrorResponse } from "@/lib/admin-auth";

const PatchBody = z.object({
  primaryOwnerId: z.string().nullable(),
});

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/admin/accounts/[id]">) {
  try {
    await requireAdmin();
    const { id } = await ctx.params;
    const body = PatchBody.parse(await req.json());

    if (body.primaryOwnerId) {
      const member = await prisma.teamMember.findUnique({
        where: { id: body.primaryOwnerId },
        select: { id: true, role: true },
      });
      if (!member) {
        return Response.json({ error: "owner not found" }, { status: 404 });
      }
    }

    const account = await prisma.account.update({
      where: { id },
      data: { primaryOwnerId: body.primaryOwnerId },
      include: { primaryOwner: { select: { id: true, name: true } } },
    });

    return Response.json({
      id: account.id,
      primaryOwnerId: account.primaryOwner?.id ?? null,
      primaryOwnerName: account.primaryOwner?.name ?? null,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return Response.json({ error: "invalid", issues: err.issues }, { status: 400 });
    }
    return adminErrorResponse(err);
  }
}
