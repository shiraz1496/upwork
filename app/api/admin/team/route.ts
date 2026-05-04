import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin, adminErrorResponse } from "@/lib/admin-auth";

export async function GET() {
  try {
    await requireAdmin();
    const members = await prisma.teamMember.findMany({
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
      include: {
        tokens: {
          where: { revokedAt: null },
          select: { id: true, label: true, lastUsedAt: true, createdAt: true },
        },
        _count: { select: { tokens: true } },
      },
    });
    return Response.json({ members });
  } catch (err) {
    return adminErrorResponse(err);
  }
}

const CreateBody = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email(),
  role: z.enum(["admin", "bidder"]).default("bidder"),
});

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = CreateBody.parse(await req.json());

    const member = await prisma.teamMember.create({ data: body });
    return Response.json({ member });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return Response.json({ error: "invalid", issues: err.issues }, { status: 400 });
    }
    return adminErrorResponse(err);
  }
}
