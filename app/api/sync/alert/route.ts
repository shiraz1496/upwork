import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { freelancerId, alerts } = body;

    if (!freelancerId || !Array.isArray(alerts)) {
      return NextResponse.json({ error: "freelancerId and alerts[] required" }, { status: 400 });
    }

    let account = await prisma.account.findUnique({ where: { freelancerId } });
    if (!account) {
      try {
        account = await prisma.account.create({ data: { freelancerId, name: freelancerId } });
      } catch {
        account = await prisma.account.findUnique({ where: { freelancerId } });
      }
    }
    if (!account) {
      return NextResponse.json({ error: "Failed to resolve account" }, { status: 500 });
    }

    let created = 0;
    let updated = 0;

    for (const alert of alerts) {
      const { type, title, senderName, preview, url, roomId, jobTitle, date,
        freelancerReplied, lastMessageSender, lastMessageText, lastMessageTime,
        needsAttention, isUnread } = alert;

      if (!type) continue;

      // Deduplicate by roomId (each conversation room is unique)
      let existing = null;
      if (roomId) {
        existing = await prisma.alert.findFirst({
          where: { accountId: account.id, roomId },
        });
      }
      // Fallback: match by senderName + type
      if (!existing && senderName) {
        existing = await prisma.alert.findFirst({
          where: { accountId: account.id, type, senderName },
          orderBy: { createdAt: "desc" },
        });
      }

      const data = {
        type,
        title: title || `Message from ${senderName || "Unknown"}`,
        senderName: senderName || null,
        preview: preview || null,
        url: url || null,
        roomId: roomId || null,
        jobTitle: jobTitle || null,
        date: date || null,
        freelancerReplied: freelancerReplied ?? false,
        lastMessageSender: lastMessageSender || null,
        lastMessageText: lastMessageText || null,
        lastMessageTime: lastMessageTime || null,
        needsAttention: needsAttention ?? false,
        isUnread: isUnread ?? false,
        // Mark as replied if freelancer replied
        replied: freelancerReplied ?? false,
      };

      if (existing) {
        await prisma.alert.update({ where: { id: existing.id }, data });
        updated++;
      } else {
        await prisma.alert.create({
          data: { accountId: account.id, ...data },
        });
        created++;
      }
    }

    // If no alerts need attention, mark ALL old unreplied message alerts as resolved
    const anyNeedAttention = alerts.some((a: Record<string, unknown>) => a.needsAttention);
    if (!anyNeedAttention) {
      await prisma.alert.updateMany({
        where: { accountId: account.id, type: "message", freelancerReplied: false },
        data: { freelancerReplied: true, needsAttention: false, replied: true },
      });
    } else {
      // Mark old alerts not in current scrape as resolved
      const currentRoomIds = alerts
        .map((a: Record<string, unknown>) => a.roomId)
        .filter((r: unknown): r is string => Boolean(r));
      if (currentRoomIds.length > 0) {
        await prisma.alert.updateMany({
          where: {
            accountId: account.id,
            type: "message",
            freelancerReplied: false,
            roomId: { notIn: currentRoomIds },
          },
          data: { freelancerReplied: true, needsAttention: false, replied: true },
        });
      }
    }

    return NextResponse.json({ ok: true, created, updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[sync/alert]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
