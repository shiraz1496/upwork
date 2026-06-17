import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin, adminErrorResponse } from "@/lib/admin-auth";
import { invalidateBlockedTitleCache } from "@/lib/blocked-titles";

const PatchBody = z.object({
  pattern: z
    .string()
    .min(2)
    .max(200)
    .transform((s) => s.toLowerCase().trim())
    .optional(),
  scope: z.enum(["all", "proposals", "contracts"]).optional(),
  active: z.boolean().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin();
    const { id } = await params;
    const body = PatchBody.parse(await req.json());
    const title = await prisma.blockedTitle.update({ where: { id }, data: body });
    invalidateBlockedTitleCache();
    return Response.json({ title });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return Response.json({ error: "invalid", issues: err.issues }, { status: 400 });
    }
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      return Response.json({ error: "duplicate" }, { status: 409 });
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
    await prisma.blockedTitle.delete({ where: { id } });
    invalidateBlockedTitleCache();
    return Response.json({ ok: true });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
