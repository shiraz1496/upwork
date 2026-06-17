import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin, adminErrorResponse } from "@/lib/admin-auth";
import { invalidateBlockedTitleCache } from "@/lib/blocked-titles";

export async function GET() {
  try {
    await requireAdmin();
    const titles = await prisma.blockedTitle.findMany({
      orderBy: [{ scope: "asc" }, { createdAt: "desc" }],
    });
    return Response.json({ titles });
  } catch (err) {
    return adminErrorResponse(err);
  }
}

const CreateBody = z.object({
  pattern: z.string().min(2).max(200).transform((s) => s.toLowerCase().trim()),
  scope: z.enum(["all", "proposals", "contracts"]).default("all"),
  active: z.boolean().default(true),
});

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = CreateBody.parse(await req.json());
    const title = await prisma.blockedTitle.create({ data: body });
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
