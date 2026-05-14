import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAttribution } from "@/lib/attribution";

export const POST = withAttribution(async ({ req, member }) => {
  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const id = parts[parts.indexOf("nudges") + 1];
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const nudge = await prisma.nudge.findUnique({ where: { id } });
  if (!nudge) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (nudge.bidderId !== member.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (nudge.deliveredAt) {
    return NextResponse.json({ ok: true, alreadyAcked: true });
  }

  await prisma.nudge.update({
    where: { id },
    data: { deliveredAt: new Date() },
  });

  return NextResponse.json({ ok: true });
});
