import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin, adminErrorResponse } from "@/lib/admin-auth";

const PatchBody = z.object({
  key: z.string().min(1).max(100).optional(),
  operator: z.enum(["gte", "lte", "eq"]).optional(),
  value: z.string().min(1).max(100).optional(),
  required: z.boolean().optional(),
  active: z.boolean().optional(),
  order: z.number().int().min(0).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin();
    const { id } = await params;
    const body = PatchBody.parse(await req.json());
    const criterion = await prisma.biddingCriterion.update({ where: { id }, data: body });
    return Response.json({ criterion });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return Response.json({ error: "invalid", issues: err.issues }, { status: 400 });
    }
    return adminErrorResponse(err);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin();
    const { id } = await params;
    await prisma.biddingCriterion.delete({ where: { id } });
    return Response.json({ ok: true });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
