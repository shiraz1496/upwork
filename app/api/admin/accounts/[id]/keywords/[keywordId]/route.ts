import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, adminErrorResponse } from "@/lib/admin-auth";

export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/admin/accounts/[id]/keywords/[keywordId]">) {
  try {
    await requireAdmin();
    const { id, keywordId } = await ctx.params;
    const existing = await prisma.accountKeyword.findUnique({ where: { id: keywordId } });
    if (!existing || existing.accountId !== id) {
      return Response.json({ error: "not found" }, { status: 404 });
    }
    await prisma.accountKeyword.delete({ where: { id: keywordId } });
    return Response.json({ ok: true });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
