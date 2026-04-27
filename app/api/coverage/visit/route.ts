import { NextRequest } from "next/server";
import { z } from "zod";
import { withAttribution } from "@/lib/attribution";
import { prisma } from "@/lib/prisma";

const Body = z.object({ pageId: z.string() });

export const POST = withAttribution(async ({ req, member }: { req: NextRequest; member: { id: string } }) => {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: "invalid" }, { status: 400 });
  }

  const { pageId } = parsed.data;
  const page = await prisma.requiredPage.findUnique({ where: { id: pageId } });
  if (!page) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  await prisma.pageVisit.upsert({
    where: { pageId_memberId: { pageId, memberId: member.id } },
    update: { visitedAt: new Date() },
    create: { pageId, memberId: member.id },
  });

  return Response.json({ ok: true });
});
