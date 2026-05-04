import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin, adminErrorResponse } from "@/lib/admin-auth";
import { generateToken, hashToken } from "@/lib/tokens";

const Body = z.object({ label: z.string().max(120).optional() });

export async function POST(req: NextRequest, ctx: RouteContext<"/api/admin/team/[id]/tokens">) {
  try {
    await requireAdmin();
    const { id } = await ctx.params;
    const { label } = Body.parse(await req.json().catch(() => ({})));

    const member = await prisma.teamMember.findUnique({ where: { id } });
    if (!member) return Response.json({ error: "not found" }, { status: 404 });

    const raw = generateToken();
    const token = await prisma.extensionToken.create({
      data: { memberId: id, tokenHash: hashToken(raw), label: label ?? null },
      select: { id: true, label: true, createdAt: true },
    });

    return Response.json({ token, raw });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return Response.json({ error: "invalid", issues: err.issues }, { status: 400 });
    }
    return adminErrorResponse(err);
  }
}
