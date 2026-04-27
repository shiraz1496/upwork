import { prisma } from "@/lib/prisma";
import { requireAdmin, adminErrorResponse } from "@/lib/admin-auth";
import { logAudit } from "@/lib/audit";

export async function DELETE(_req: Request, ctx: RouteContext<"/api/admin/team/tokens/[tokenId]">) {
  try {
    const admin = await requireAdmin();
    const { tokenId } = await ctx.params;

    const existing = await prisma.extensionToken.findUnique({ where: { id: tokenId } });
    if (!existing) return Response.json({ error: "not found" }, { status: 404 });
    if (existing.revokedAt) return Response.json({ ok: true, alreadyRevoked: true });

    await prisma.extensionToken.update({
      where: { id: tokenId },
      data: { revokedAt: new Date() },
    });

    await logAudit({
      event: "token.revoked",
      actorId: admin.id,
      subjectType: "ExtensionToken",
      subjectId: tokenId,
      meta: { memberId: existing.memberId, label: existing.label },
    });

    return Response.json({ ok: true });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
