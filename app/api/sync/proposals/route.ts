import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAttribution, firstCaptureFields, resolveAccount } from "@/lib/attribution";
import { upsertCoverageReference } from "@/lib/coverage";

const ACTIVE_SECTIONS = new Set(["Active", "Interviewing", "Offers"]);
const VIEWED_SECTIONS = new Set(["Active proposals", "Interviewing", "Offers", "Active"]);

const BAD_TITLES = new Set([
  "open job in a new window", "open job", "my proposals", "my stats",
  "find work", "saved jobs", "send a proposal", "submit a proposal",
  "learn more", "upgrade", "contract-to-hire", "similar jobs",
  "apply now", "save job", "view profile", "sign in", "log in",
  "messages", "help", "settings", "view job posting", "view job",
  "proposal details", "job details", "insights",
  "search for jobs", "manage your profile", "browse jobs", "find a job",
  "post a job", "manage finances", "reports",
  "send a message", "submit work for payment", "leave feedback",
  "view offer", "accept offer", "decline offer", "end contract",
  "give a bonus", "fund milestone", "request an extension",
  "view contract", "start contract", "review contract", "pay bonus",
  "job is closed", "viewed by client", "personal note from client",
  "schedule a rate increase", "footer navigation", "freelancer plus",
]);

function isBadTitle(title: string): boolean {
  const lower = title.toLowerCase().trim();
  if (lower.length < 5) return true;
  // "Your proposal for <job title> was viewed." — notification text
  if (/^your proposal for .+ was viewed\.?$/.test(lower)) return true;
  // "New job: <title> <time>" — Upwork new-job notification
  if (/^new job:/.test(lower)) return true;
  // "Your proposal may still appear if a boosted slot reopens..." — auction notice
  if (/^your proposal may still appear/.test(lower)) return true;
  // Pagination / UI chrome
  if (/^current page \d/.test(lower)) return true;
  // Upwork "Freelancer Plus" upsell banner
  if (/freelancer plus/.test(lower)) return true;
  for (const bad of BAD_TITLES) {
    if (lower === bad) return true;
    // Only substring-match multi-word phrases; single/two-word entries must match exactly
    if (bad.split(" ").length >= 3 && lower.includes(bad)) return true;
  }
  return false;
}

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
      if (!p.title || isBadTitle(p.title)) {
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
