import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, adminErrorResponse } from "@/lib/admin-auth";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const { searchParams } = req.nextUrl;
    const event = searchParams.get("event") || undefined;
    const actorId = searchParams.get("actorId") || undefined;
    const limit = Math.min(Number(searchParams.get("limit") || 50), 200);
    const offset = Math.max(0, Number(searchParams.get("offset") || 0));

    const where = {
      ...(event ? { event } : {}),
      ...(actorId ? { actorId } : {}),
    };

    const [logs, total, eventRows, members] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: { actor: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
        skip: offset,
        take: limit,
      }),
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        select: { event: true },
        distinct: ["event"],
        orderBy: { event: "asc" },
      }),
      prisma.teamMember.findMany({
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
    ]);

    return Response.json({
      logs,
      total,
      events: eventRows.map((r) => r.event),
      members,
    });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
