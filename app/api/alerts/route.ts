import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logError } from "@/lib/log";
import { requireAdmin, adminErrorResponse, AdminAuthError } from "@/lib/admin-auth";

export async function GET() {
  try {
    await requireAdmin();
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
        capturedByUser: { select: { id: true, name: true } },
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
      capturedBy: a.capturedByUser
        ? { id: a.capturedByUser.id, name: a.capturedByUser.name }
        : null,
    }));

    return NextResponse.json(result);
  } catch (err: unknown) {
    if (err instanceof AdminAuthError) return adminErrorResponse(err);
    logError("alerts", err);
    return NextResponse.json({ error: "Failed to fetch alerts" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    await requireAdmin();
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
    if (err instanceof AdminAuthError) return adminErrorResponse(err);
    logError("alerts PATCH", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
