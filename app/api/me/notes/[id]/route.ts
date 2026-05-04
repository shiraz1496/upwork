import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveMeSession, authErrorResponse } from "@/lib/me-auth";

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/me/notes/[id]">) {
  try {
    const { member } = await resolveMeSession(req);
    const { id } = await ctx.params;

    const existing = await prisma.coachingNote.findUnique({ where: { id } });
    if (!existing) return Response.json({ error: "not_found" }, { status: 404 });
    if (existing.recipientId !== member.id) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
    if (existing.readAt) return Response.json({ ok: true, alreadyRead: true });

    await prisma.coachingNote.update({
      where: { id },
      data: { readAt: new Date() },
    });

    return Response.json({ ok: true });
  } catch (err) {
    return authErrorResponse(err);
  }
}
