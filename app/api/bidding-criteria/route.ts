import { prisma } from "@/lib/prisma";
import { resolveExtensionToken, authErrorResponse } from "@/lib/member-auth";

export async function GET(req: Request) {
  try {
    await resolveExtensionToken(req);
    const criteria = await prisma.biddingCriterion.findMany({
      where: { active: true },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      select: { id: true, key: true, operator: true, value: true, required: true },
    });
    return Response.json({ criteria });
  } catch (err) {
    return authErrorResponse(err);
  }
}
