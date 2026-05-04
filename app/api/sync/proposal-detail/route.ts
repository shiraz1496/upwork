import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAttribution, firstCaptureFields, resolveAccount } from "@/lib/attribution";
import { markCoverageCaptured } from "@/lib/coverage";

export const POST = withAttribution(async ({ req, member }) => {
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

    if (!freelancerId) return NextResponse.json({ error: "freelancerId required" }, { status: 400 });

    const account = await resolveAccount(freelancerId);
    if (!account) return NextResponse.json({ error: "Failed to resolve account" }, { status: 500 });

    const jobUrl = url ? url.split("?")[0] : null;
    let proposal = null;
    if (jobUrl) proposal = await prisma.proposal.findFirst({ where: { accountId: account.id, jobUrl } });
    if (!proposal && title) proposal = await prisma.proposal.findFirst({ where: { accountId: account.id, jobTitle: title } });
    if (!proposal && title && title.length > 5)
      proposal = await prisma.proposal.findFirst({ where: { accountId: account.id, jobTitle: { startsWith: title.slice(0, 20) } } });
    if (!proposal && jobUrl) {
      const jobIdMatch = jobUrl.match(/~(\w+)/);
      if (jobIdMatch) proposal = await prisma.proposal.findFirst({ where: { accountId: account.id, jobUrl: { contains: jobIdMatch[1] } } });
    }

    const detailData = {
      ...(section ? { section } : {}),
      ...(status ? { status } : {}),
      ...(submittedAt ? { submittedAt: new Date(String(submittedAt).replace(/\s+at\s+/i, " ").trim()) } : {}),
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
      await prisma.proposal.update({
        where: { id: proposal.id },
        data: {
          ...detailData,
          ...(jobUrl && !proposal.jobUrl ? { jobUrl } : {}),
          ...(submittedViaExtension ? { submittedByUserId: member.id } : {}),
        },
      });
      if (jobUrl) {
        await markCoverageCaptured({
          memberId: member.id,
          accountId: account.id,
          entityType: "proposal",
          entityId: jobUrl,
        });
      }
      return NextResponse.json({ ok: true, proposalId: proposal.id, updated: true });
    }
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
        ...firstCaptureFields(member),
        ...(submittedViaExtension ? { submittedByUserId: member.id } : {}),
      },
    });
    if (jobUrl) {
      await markCoverageCaptured({
        memberId: member.id,
        accountId: account.id,
        entityType: "proposal",
        entityId: jobUrl,
      });
    }
    return NextResponse.json({ ok: true, proposalId: newProposal.id, created: true });
  } catch (err) {
    console.error("[sync/proposal-detail]", err);
    return NextResponse.json({ error: "Failed to sync proposal detail" }, { status: 500 });
  }
});
