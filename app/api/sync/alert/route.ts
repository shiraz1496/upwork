import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAttribution, firstCaptureFields, resolveAccount } from "@/lib/attribution";
import { logAudit } from "@/lib/audit";
import { upsertCoverageReference, markCoverageCaptured } from "@/lib/coverage";

export const POST = withAttribution(async ({ req, member }) => {
  try {
    const body = await req.json();
    const { freelancerId, alerts } = body;

    if (!freelancerId || !Array.isArray(alerts)) {
      return NextResponse.json({ error: "freelancerId and alerts[] required" }, { status: 400 });
    }

    const account = await resolveAccount(freelancerId);
    if (!account) return NextResponse.json({ error: "Failed to resolve account" }, { status: 500 });

    let created = 0;
    let updated = 0;

    for (const alert of alerts) {
      const {
        type, title, senderName, preview, url, roomId, jobTitle, date,
        freelancerReplied, lastMessageSender, lastMessageText, lastMessageTime,
        needsAttention, isUnread,
      } = alert;

      if (!type) {
        await logAudit({
          event: "sync.skipped_record",
          actorId: member.id,
          subjectType: "Alert",
          meta: { reason: "no_type", keys: Object.keys(alert || {}) },
        });
        continue;
      }

      let existing = null;
      if (roomId) existing = await prisma.alert.findFirst({ where: { accountId: account.id, roomId } });
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
        replied: freelancerReplied ?? false,
      };

      if (existing) {
        await prisma.alert.update({ where: { id: existing.id }, data });
        updated++;
      } else {
        await prisma.alert.create({
          data: { accountId: account.id, ...data, ...firstCaptureFields(member) },
        });
        created++;
      }

      if (type === "message" && roomId) {
        if (freelancerReplied) {
          await markCoverageCaptured({
            memberId: member.id,
            accountId: account.id,
            entityType: "message_thread",
            entityId: roomId,
          });
        } else if (needsAttention || isUnread) {
          const reasonTags: string[] = [];
          if (isUnread) reasonTags.push("unread");
          if (needsAttention) reasonTags.push("needs_reply");
          await upsertCoverageReference({
            memberId: member.id,
            accountId: account.id,
            entityType: "message_thread",
            entityId: roomId,
            openUrl: url,
            reasonTags,
          });
        }
      }

      if (type === "offer") {
        const entityId = roomId || url || title;
        await upsertCoverageReference({
          memberId: member.id,
          accountId: account.id,
          entityType: "offer",
          entityId,
          openUrl: url,
          reasonTags: ["offer"],
        });
      }
    }

    const anyNeedAttention = alerts.some((a: Record<string, unknown>) => a.needsAttention);
    if (!anyNeedAttention) {
      await prisma.alert.updateMany({
        where: { accountId: account.id, type: "message", freelancerReplied: false },
        data: { freelancerReplied: true, needsAttention: false, replied: true },
      });
    } else {
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
  } catch (err) {
    console.error("[sync/alert]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown" }, { status: 500 });
  }
});
