import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      freelancerId, title, url, coverLetter, clientNote, viewedByClient, clientName, clientCountry,
      proposedRate, receivedRate, rateIncrease, bidConnects,
      jobBudget, jobHoursPerWeek, jobDuration, jobExperienceLevel, jobDescription, jobSkills,
      jobPostedDate, jobCategory, profileUsed,
      clientRating, clientReviews, clientReviewScore, clientCity,
      clientJobsPosted, clientHireRate, clientOpenJobs, clientTotalSpent,
      clientHires, clientActiveHires, clientAvgRate, clientTotalHours,
      clientMemberSince, clientPaymentVerified,
      section, status, submittedAt, submittedViaExtension,
    } = body;

    if (!freelancerId) {
      return NextResponse.json({ error: "freelancerId required" }, { status: 400 });
    }

    let account = await prisma.account.findUnique({ where: { freelancerId: String(freelancerId) } });
    if (!account) {
      try {
        account = await prisma.account.create({
          data: { freelancerId: String(freelancerId), name: String(freelancerId) },
        });
      } catch {
        account = await prisma.account.findUnique({ where: { freelancerId: String(freelancerId) } });
      }
    }
    if (!account) {
      return NextResponse.json({ error: "Failed to resolve account" }, { status: 500 });
    }

    // Find existing proposal by job URL or title
    const jobUrl = url ? url.split("?")[0] : null;
    let proposal = null;

    if (jobUrl) {
      proposal = await prisma.proposal.findFirst({
        where: { accountId: account.id, jobUrl },
      });
    }

    // If not found by URL, try finding by exact title
    if (!proposal && title) {
      proposal = await prisma.proposal.findFirst({
        where: { accountId: account.id, jobTitle: title },
      });
    }

    // If still not found, try partial title match (list page may truncate)
    if (!proposal && title && title.length > 5) {
      proposal = await prisma.proposal.findFirst({
        where: { accountId: account.id, jobTitle: { startsWith: title.slice(0, 20) } },
      });
    }

    // Last resort: try matching by job URL containing the same job ID
    if (!proposal && jobUrl) {
      const jobIdMatch = jobUrl.match(/~(\w+)/);
      if (jobIdMatch) {
        proposal = await prisma.proposal.findFirst({
          where: { accountId: account.id, jobUrl: { contains: jobIdMatch[1] } },
        });
      }
    }

    // Build the detail data object with all new fields
    const detailData = {
      ...(section ? { section } : {}),
      ...(status ? { status } : {}),
      ...(submittedAt ? { submittedAt: new Date(submittedAt) } : {}),
      ...(submittedViaExtension != null ? { submittedViaExtension } : {}),
      ...(coverLetter ? { coverLetter } : {}),
      ...(clientNote ? { clientNote } : {}),
      ...(viewedByClient != null ? { viewedByClient } : {}),
      ...(clientName ? { clientName } : {}),
      ...(clientCountry ? { clientCountry } : {}),
      ...(proposedRate ? { proposedRate } : {}),
      ...(receivedRate ? { receivedRate } : {}),
      ...(rateIncrease ? { rateIncrease } : {}),
      ...(bidConnects != null ? { bidConnects } : {}),
      ...(jobBudget ? { jobBudget } : {}),
      ...(jobHoursPerWeek ? { jobHoursPerWeek } : {}),
      ...(jobDuration ? { jobDuration } : {}),
      ...(jobExperienceLevel ? { jobExperienceLevel } : {}),
      ...(jobDescription ? { jobDescription } : {}),
      ...(jobSkills && jobSkills.length > 0 ? { jobSkills } : {}),
      ...(jobPostedDate ? { jobPostedDate } : {}),
      ...(jobCategory ? { jobCategory } : {}),
      ...(profileUsed ? { profileUsed } : {}),
      ...(clientRating != null ? { clientRating } : {}),
      ...(clientReviews != null ? { clientReviews } : {}),
      ...(clientReviewScore ? { clientReviewScore } : {}),
      ...(clientCity ? { clientCity } : {}),
      ...(clientJobsPosted != null ? { clientJobsPosted } : {}),
      ...(clientHireRate != null ? { clientHireRate } : {}),
      ...(clientOpenJobs != null ? { clientOpenJobs } : {}),
      ...(clientTotalSpent ? { clientTotalSpent } : {}),
      ...(clientHires != null ? { clientHires } : {}),
      ...(clientActiveHires != null ? { clientActiveHires } : {}),
      ...(clientAvgRate ? { clientAvgRate } : {}),
      ...(clientTotalHours ? { clientTotalHours } : {}),
      ...(clientMemberSince ? { clientMemberSince } : {}),
      ...(clientPaymentVerified != null ? { clientPaymentVerified } : {}),
    };

    if (proposal) {
      // Update existing proposal with detail data
      await prisma.proposal.update({
        where: { id: proposal.id },
        data: {
          ...detailData,
          ...(jobUrl && !proposal.jobUrl ? { jobUrl } : {}),
        },
      });
      return NextResponse.json({ ok: true, proposalId: proposal.id, updated: true });
    } else {
      // Create new proposal with detail data
      const newProposal = await prisma.proposal.create({
        data: {
          accountId: account.id,
          jobTitle: title || null,
          jobUrl: jobUrl || null,
          coverLetter: coverLetter || null,
          clientNote: clientNote || null,
          viewedByClient: viewedByClient ?? false,
          clientName: clientName || null,
          clientCountry: clientCountry || null,
          submittedViaExtension: submittedViaExtension ?? false,
          ...detailData,
        },
      });
      return NextResponse.json({ ok: true, proposalId: newProposal.id, created: true });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[sync/proposal-detail]", message);
    return NextResponse.json({ error: "Failed to sync proposal detail" }, { status: 500 });
  }
}
