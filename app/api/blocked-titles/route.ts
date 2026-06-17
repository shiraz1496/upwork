import { prisma } from "@/lib/prisma";
import { resolveExtensionToken, authErrorResponse } from "@/lib/member-auth";

export async function GET(req: Request) {
  try {
    await resolveExtensionToken(req);
    const titles = await prisma.blockedTitle.findMany({
      where: { active: true },
      orderBy: [{ scope: "asc" }, { createdAt: "asc" }],
      select: { pattern: true, scope: true },
    });
    return Response.json({ titles });
  } catch (err) {
    return authErrorResponse(err);
  }
}
