import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveMeSession, authErrorResponse } from "@/lib/me-auth";

export async function GET(req: NextRequest) {
  try {
    await resolveMeSession(req);
    const freelancerId = new URL(req.url).searchParams.get("freelancerId");
    if (!freelancerId) {
      return Response.json({ keywords: [] });
    }
    const account = await prisma.account.findUnique({
      where: { freelancerId },
      select: { id: true },
    });
    if (!account) return Response.json({ keywords: [] });

    const keywords = await prisma.accountKeyword.findMany({
      where: { accountId: account.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, text: true },
    });
    return Response.json({ keywords });
  } catch (err) {
    return authErrorResponse(err);
  }
}
