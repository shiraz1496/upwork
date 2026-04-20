import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const alerts = await prisma.alert.findMany({
      where: {
        createdAt: { gte: sevenDaysAgo },
        OR: [
          { freelancerReplied: false, needsAttention: true },
          { isUnread: true },
          { read: false, freelancerReplied: false },
        ],
      },
      include: {
        account: {
          select: { name: true, freelancerId: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    const result = alerts.map((a) => ({
      id: a.id,
      accountId: a.accountId,
      accountName: a.account.name,
      type: a.type,
      title: a.title,
      senderName: a.senderName,
      preview: a.preview,
      url: a.url,
      roomId: a.roomId,
      jobTitle: a.jobTitle,
      date: a.date,
      freelancerReplied: a.freelancerReplied,
      lastMessageSender: a.lastMessageSender,
      lastMessageText: a.lastMessageText,
      lastMessageTime: a.lastMessageTime,
      needsAttention: a.needsAttention,
      isUnread: a.isUnread,
      read: a.read,
      replied: a.replied,
      notifiedAt: a.notifiedAt,
      remindedAt: a.remindedAt,
      createdAt: a.createdAt,
    }));

    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[alerts]", message);
    return NextResponse.json({ error: "Failed to fetch alerts" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { id, read, replied } = body;

    if (!id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }

    const data: Record<string, unknown> = {};
    if (read !== undefined) data.read = read;
    if (replied !== undefined) data.replied = replied;

    const updated = await prisma.alert.update({
      where: { id },
      data,
    });

    return NextResponse.json({ ok: true, alert: updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[alerts PATCH]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
