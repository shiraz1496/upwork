import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin, adminErrorResponse } from "@/lib/admin-auth";

export async function GET() {
  try {
    await requireAdmin();
    const criteria = await prisma.biddingCriterion.findMany({
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    });
    return Response.json({ criteria });
  } catch (err) {
    return adminErrorResponse(err);
  }
}

const CreateBody = z.object({
  key: z.string().min(1).max(100),
  operator: z.enum(["gte", "lte", "eq"]).default("gte"),
  value: z.string().min(1).max(100),
  required: z.boolean().default(true),
  order: z.number().int().min(0).default(0),
});

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = CreateBody.parse(await req.json());
    const criterion = await prisma.biddingCriterion.create({ data: body });
    return Response.json({ criterion });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return Response.json({ error: "invalid", issues: err.issues }, { status: 400 });
    }
    return adminErrorResponse(err);
  }
}
