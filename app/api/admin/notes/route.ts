import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin, adminErrorResponse } from "@/lib/admin-auth";
import { logAudit } from "@/lib/audit";

const Body = z.object({
  recipientId: z.string().min(1),
  body: z.string().min(1).max(4000),
  proposalId: z.string().optional().nullable(),
});

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin();
    const { recipientId, body, proposalId } = Body.parse(await req.json());

    const recipient = await prisma.teamMember.findUnique({ where: { id: recipientId } });
    if (!recipient) return Response.json({ error: "recipient_not_found" }, { status: 404 });

    const note = await prisma.coachingNote.create({
      data: {
        authorId: admin.id,
        recipientId,
        proposalId: proposalId || null,
        body,
      },
    });

    await logAudit({
      event: "note.created",
      actorId: admin.id,
      subjectType: "CoachingNote",
      subjectId: note.id,
      meta: { recipientId, proposalId: proposalId || null, length: body.length },
    });

    return Response.json({ note });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return Response.json({ error: "invalid", issues: err.issues }, { status: 400 });
    }
    return adminErrorResponse(err);
  }
}
