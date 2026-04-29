import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin, adminErrorResponse } from "@/lib/admin-auth";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin();
    const { id } = await params;
    await prisma.requiredPage.delete({ where: { id } });
    return Response.json({ ok: true });
  } catch (err) {
    return adminErrorResponse(err);
  }
}

const PatchBody = z.object({
  name: z.string().min(1).max(100).optional(),
  url: z.string().startsWith("https://").optional(),
  cooldownHours: z.number().int().min(1).max(168).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin();
    const { id } = await params;
    const body = PatchBody.parse(await req.json());
    const page = await prisma.requiredPage.update({ where: { id }, data: body });
    return Response.json({ page });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return Response.json({ error: "invalid", issues: err.issues }, { status: 400 });
    }
    return adminErrorResponse(err);
  }
}
