import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin, adminErrorResponse } from "@/lib/admin-auth";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/admin/accounts/[id]/keywords">) {
  try {
    await requireAdmin();
    const { id } = await ctx.params;
    const keywords = await prisma.accountKeyword.findMany({
      where: { accountId: id },
      orderBy: { createdAt: "asc" },
      select: { id: true, text: true, createdAt: true },
    });
    return Response.json({ keywords });
  } catch (err) {
    return adminErrorResponse(err);
  }
}

const CreateBody = z.object({
  text: z.string().min(1).max(200).trim(),
});

export async function POST(req: NextRequest, ctx: RouteContext<"/api/admin/accounts/[id]/keywords">) {
  try {
    await requireAdmin();
    const { id } = await ctx.params;
    const body = CreateBody.parse(await req.json());

    const account = await prisma.account.findUnique({ where: { id }, select: { id: true } });
    if (!account) return Response.json({ error: "not found" }, { status: 404 });

    const keyword = await prisma.accountKeyword.create({
      data: { accountId: id, text: body.text },
      select: { id: true, text: true, createdAt: true },
    });
    return Response.json({ keyword });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return Response.json({ error: "invalid", issues: err.issues }, { status: 400 });
    }
    return adminErrorResponse(err);
  }
}
