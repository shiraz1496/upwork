import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveMeSession, authErrorResponse } from "@/lib/me-auth";

export async function GET(req: NextRequest) {
  try {
    const { member } = await resolveMeSession(req);

    const [notes, unreadCount] = await Promise.all([
      prisma.coachingNote.findMany({
        where: { recipientId: member.id },
        include: {
          author: { select: { id: true, name: true } },
          proposal: { select: { id: true, jobTitle: true, jobUrl: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      prisma.coachingNote.count({
        where: { recipientId: member.id, readAt: null },
      }),
    ]);

    return Response.json({
      member: { id: member.id, name: member.name },
      unreadCount,
      notes: notes.map((n) => ({
        id: n.id,
        body: n.body,
        createdAt: n.createdAt,
        readAt: n.readAt,
        author: n.author,
        proposal: n.proposal,
      })),
    });
  } catch (err) {
    return authErrorResponse(err);
  }
}
