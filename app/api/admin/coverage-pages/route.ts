import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin, adminErrorResponse } from "@/lib/admin-auth";

export async function GET() {
  try {
    await requireAdmin();
    const pages = await prisma.requiredPage.findMany({
      orderBy: { createdAt: "asc" },
      include: { _count: { select: { visits: true } } },
    });
    return Response.json({ pages });
  } catch (err) {
    return adminErrorResponse(err);
  }
}

const CreateBody = z.object({
  name: z.string().min(1).max(100),
  url: z.string().startsWith("https://"),
});

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = CreateBody.parse(await req.json());
    const page = await prisma.requiredPage.create({ data: body });
    return Response.json({ page });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return Response.json({ error: "invalid", issues: err.issues }, { status: 400 });
    }
    return adminErrorResponse(err);
  }
}
