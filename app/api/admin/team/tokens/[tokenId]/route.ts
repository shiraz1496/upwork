import { prisma } from "@/lib/prisma";
import { requireAdmin, adminErrorResponse } from "@/lib/admin-auth";

export async function DELETE(_req: Request, ctx: RouteContext<"/api/admin/team/tokens/[tokenId]">) {
  try {
    await requireAdmin();
    const { tokenId } = await ctx.params;

    const existing = await prisma.extensionToken.findUnique({ where: { id: tokenId } });
    if (!existing) return Response.json({ error: "not found" }, { status: 404 });
    if (existing.revokedAt) return Response.json({ ok: true, alreadyRevoked: true });

    await prisma.extensionToken.update({
      where: { id: tokenId },
      data: { revokedAt: new Date() },
    });

    return Response.json({ ok: true });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
