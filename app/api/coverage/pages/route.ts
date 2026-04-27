import { withAttribution } from "@/lib/attribution";
import { prisma } from "@/lib/prisma";

export const GET = withAttribution(async () => {
  const pages = await prisma.requiredPage.findMany({
    select: { id: true, name: true, url: true },
    orderBy: { createdAt: "asc" },
  });
  return Response.json({ pages });
});
