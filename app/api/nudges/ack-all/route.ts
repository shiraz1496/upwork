import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAttribution } from "@/lib/attribution";

export const POST = withAttribution(async ({ member }) => {
  const result = await prisma.nudge.updateMany({
    where: { bidderId: member.id, deliveredAt: null },
    data: { deliveredAt: new Date() },
  });
  return NextResponse.json({ ok: true, acked: result.count });
});
