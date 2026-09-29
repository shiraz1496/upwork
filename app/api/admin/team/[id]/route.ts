import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin, adminErrorResponse } from "@/lib/admin-auth";
import { hashPassword } from "@/lib/crypto";

const PatchBody = z.object({
  name: z.string().min(1).max(120).optional(),
  email: z.string().email().optional(),
  role: z.enum(["admin", "bidder"]).optional(),
  status: z.enum(["active", "inactive"]).optional(),
  password: z.string().min(8).max(200).optional(),
});

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/admin/team/[id]">) {
  try {
    await requireAdmin();
    const { id } = await ctx.params;
    const body = PatchBody.parse(await req.json());

    const before = await prisma.teamMember.findUnique({ where: { id } });
    if (!before) return Response.json({ error: "not found" }, { status: 404 });

    const { password, ...fields } = body;
    // Role/status/password changes invalidate every existing session for this member.
    const invalidate =
      password !== undefined ||
      (fields.role !== undefined && fields.role !== before.role) ||
      (fields.status !== undefined && fields.status !== before.status);

    const member = await prisma.teamMember.update({
      where: { id },
      data: {
        ...fields,
        ...(password !== undefined && { passwordHash: hashPassword(password), passwordSetAt: new Date() }),
        ...(invalidate && { sessionVersion: { increment: 1 } }),
      },
    });
    return Response.json({ member });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return Response.json({ error: "invalid", issues: err.issues }, { status: 400 });
    }
    return adminErrorResponse(err);
  }
}
