import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAttribution, firstCaptureFields, resolveAccount } from "@/lib/attribution";
import { logAudit } from "@/lib/audit";
import { upsertCoverageReference } from "@/lib/coverage";

const ACTIVE_SECTIONS = new Set(["Active", "Interviewing", "Offers"]);
const VIEWED_SECTIONS = new Set(["Active proposals", "Interviewing", "Offers", "Active"]);

function tryParseDate(str: string): Date | null {
  if (!str) return null;
  const cleaned = str.replace(/\s+at\s+/i, " ").trim();
  // If no time component, force UTC midnight so stored value is timezone-independent
  if (!/\d{1,2}:\d{2}/.test(cleaned)) {
    const utc = new Date(cleaned + " UTC");
    if (!isNaN(utc.getTime())) return utc;
  }
  const d = new Date(cleaned);
  return isNaN(d.getTime()) ? null : d;
}

export const POST = withAttribution(async ({ req, member }) => {
  try {
    const body = await req.json();
    const { freelancerId, proposals } = body;
    if (!freelancerId || !Array.isArray(proposals)) {
      return NextResponse.json({ error: "freelancerId and proposals array required" }, { status: 400 });
    }

    const account = await resolveAccount(freelancerId);
    if (!account) return NextResponse.json({ error: "Failed to resolve account" }, { status: 500 });

    let saved = 0;
    for (const p of proposals) {
      if (!p.title) {
        await logAudit({
          event: "sync.skipped_record",
          actorId: member.id,
          subjectType: "Proposal",
          meta: { reason: "no_title", keys: Object.keys(p || {}) },
        });
        continue;
      }
      const jobUrl = p.url || null;
      const parsedDate = tryParseDate(p.submittedAt);

      const impliedViewed = p.section ? VIEWED_SECTIONS.has(p.section) : false;
      const updateData = {
        jobTitle: p.title,
        status: p.status ?? undefined,
        section: p.section ?? undefined,
        boosted: p.boosted ?? false,
        boostStatus: p.boostStatus ?? undefined,
        viewedByClient: impliedViewed || (p.viewedByClient ?? undefined),
        submittedAt: parsedDate ?? undefined,
        profileUsed: p.profileUsed ?? undefined,
        ...(jobUrl ? { jobUrl } : {}),
      };

      let existing = null;
      if (jobUrl) existing = await prisma.proposal.findFirst({ where: { accountId: account.id, jobUrl } });
      if (!existing) existing = await prisma.proposal.findFirst({ where: { accountId: account.id, jobTitle: p.title } });

      if (existing) {
        await prisma.proposal.update({ where: { id: existing.id }, data: updateData });
      } else {
        await prisma.proposal.create({
          data: {
            accountId: account.id,
            jobTitle: p.title,
            jobUrl: jobUrl,
            status: p.status ?? null,
            section: p.section ?? null,
            boosted: p.boosted ?? false,
            boostStatus: p.boostStatus ?? null,
            viewedByClient: p.viewedByClient ?? false,
            submittedAt: parsedDate ?? null,
            profileUsed: p.profileUsed ?? null,
            ...firstCaptureFields(member),
          },
        });
      }

      if (p.section && ACTIVE_SECTIONS.has(p.section) && jobUrl) {
        const reasonTags: string[] = [];
        if (p.section === "Offers") reasonTags.push("offer_stage");
        else if (p.section === "Interviewing") reasonTags.push("interview_stage");
        if (p.viewedByClient) reasonTags.push("viewed");
        reasonTags.push("submitted");
        await upsertCoverageReference({
          memberId: member.id,
          accountId: account.id,
          entityType: "proposal",
          entityId: jobUrl,
          openUrl: jobUrl,
          reasonTags,
        });
      }

      saved++;
    }

    return NextResponse.json({ ok: true, saved });
  } catch (err) {
    console.error("[sync/proposals]", err);
    return NextResponse.json({ error: "Failed to sync proposals" }, { status: 500 });
  }
});
