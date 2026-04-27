import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin, adminErrorResponse } from "@/lib/admin-auth";
import { logAudit } from "@/lib/audit";

const PatchBody = z.object({
  name: z.string().min(1).max(120).optional(),
  email: z.string().email().optional(),
  role: z.enum(["admin", "bidder"]).optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/admin/team/[id]">) {
  try {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const body = PatchBody.parse(await req.json());

    const before = await prisma.teamMember.findUnique({ where: { id } });
    if (!before) return Response.json({ error: "not found" }, { status: 404 });

    const member = await prisma.teamMember.update({ where: { id }, data: body });

    if (body.status && body.status !== before.status) {
      await logAudit({
        event: "member.status_changed",
        actorId: admin.id,
        subjectType: "TeamMember",
        subjectId: member.id,
        meta: { from: before.status, to: body.status },
      });
    }
    return Response.json({ member });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return Response.json({ error: "invalid", issues: err.issues }, { status: 400 });
    }
    return adminErrorResponse(err);
  }
}
