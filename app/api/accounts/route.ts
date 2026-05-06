import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const accounts = await prisma.account.findMany({
      include: {
        primaryOwner: { select: { id: true, name: true } },
        snapshots: {
          orderBy: { capturedAt: "desc" },
        },
        proposals: {
          orderBy: { createdAt: "desc" },
          take: 100,
          include: {
            capturedByUser: { select: { id: true, name: true } },
            submittedByUser: { select: { id: true, name: true } },
          },
        },
        alerts: {
          where: { read: false },
          orderBy: { createdAt: "desc" },
          take: 50,
          include: { capturedByUser: { select: { id: true, name: true } } },
        },
      },
    });

    const result = accounts.map((account) => {
      const snapshots = account.snapshots;
      const latest = snapshots[0];

      const snapshotSummaries = snapshots
        .map((s) => {
          const sent = (s.proposalsSentBoosted ?? 0) + (s.proposalsSentOrganic ?? 0);
          const viewed = (s.proposalsViewedBoosted ?? 0) + (s.proposalsViewedOrganic ?? 0);
          const interviewed = (s.proposalsInterviewedBoosted ?? 0) + (s.proposalsInterviewedOrganic ?? 0);
          const hired = (s.proposalsHiredBoosted ?? 0) + (s.proposalsHiredOrganic ?? 0);
          return {
            id: s.id,
            capturedAt: s.capturedAt,
            startTimestamp: s.startTimestamp,
            endTimestamp: s.endTimestamp,
            range: s.range,
            jss: s.jss,
            connectsBalance: s.connectsBalance,
            sent, viewed, interviewed, hired,
            boostedSent: s.proposalsSentBoosted ?? 0,
            organicSent: s.proposalsSentOrganic ?? 0,
            boostedViewed: s.proposalsViewedBoosted ?? 0,
            organicViewed: s.proposalsViewedOrganic ?? 0,
            boostedInterviewed: s.proposalsInterviewedBoosted ?? 0,
            organicInterviewed: s.proposalsInterviewedOrganic ?? 0,
            boostedHired: s.proposalsHiredBoosted ?? 0,
            organicHired: s.proposalsHiredOrganic ?? 0,
            viewRate: sent > 0 ? Math.round((viewed / sent) * 1000) / 10 : 0,
            interviewRate: sent > 0 ? Math.round((interviewed / sent) * 1000) / 10 : 0,
            hireRate: sent > 0 ? Math.round((hired / sent) * 1000) / 10 : 0,
          };
        })
        .reverse();

      const latestSent = latest ? (latest.proposalsSentBoosted ?? 0) + (latest.proposalsSentOrganic ?? 0) : 0;
      const latestViewed = latest ? (latest.proposalsViewedBoosted ?? 0) + (latest.proposalsViewedOrganic ?? 0) : 0;
      const latestInterviewed = latest ? (latest.proposalsInterviewedBoosted ?? 0) + (latest.proposalsInterviewedOrganic ?? 0) : 0;
      const latestHired = latest ? (latest.proposalsHiredBoosted ?? 0) + (latest.proposalsHiredOrganic ?? 0) : 0;

      return {
        id: account.id,
        freelancerId: account.freelancerId,
        name: account.name,
        jss: account.jss,
        connectsBalance: account.connectsBalance,
        createdAt: account.createdAt,
        latestSnapshot: latest
          ? {
              capturedAt: latest.capturedAt,
              startTimestamp: latest.startTimestamp,
              endTimestamp: latest.endTimestamp,
              jss: latest.jss ?? account.jss,
              connectsBalance: latest.connectsBalance ?? account.connectsBalance,
              funnel: { sent: latestSent, viewed: latestViewed, interviewed: latestInterviewed, hired: latestHired },
              boosted: {
                sent: latest.proposalsSentBoosted ?? 0,
                viewed: latest.proposalsViewedBoosted ?? 0,
                interviewed: latest.proposalsInterviewedBoosted ?? 0,
                hired: latest.proposalsHiredBoosted ?? 0,
              },
              organic: {
                sent: latest.proposalsSentOrganic ?? 0,
                viewed: latest.proposalsViewedOrganic ?? 0,
                interviewed: latest.proposalsInterviewedOrganic ?? 0,
                hired: latest.proposalsHiredOrganic ?? 0,
              },
              viewRate: latestSent > 0 ? Math.round((latestViewed / latestSent) * 1000) / 10 : 0,
              interviewRate: latestSent > 0 ? Math.round((latestInterviewed / latestSent) * 1000) / 10 : 0,
              hireRate: latestSent > 0 ? Math.round((latestHired / latestSent) * 1000) / 10 : 0,
            }
          : null,
        snapshots: snapshotSummaries,
        snapshotCount: snapshots.length,
        proposals: account.proposals.map((p) => ({
          id: p.id,
          jobTitle: p.jobTitle,
          jobUrl: p.jobUrl,
          jobCategory: p.jobCategory,
          status: p.status,
          section: p.section,
          boosted: p.boosted,
          boostStatus: p.boostStatus,
          viewedByClient: p.viewedByClient,
          coverLetter: p.coverLetter,
          clientName: p.clientName,
          clientCountry: p.clientCountry,
          connectsSpent: p.connectsSpent,
          submittedAt: p.submittedAt,
          submittedViaExtension: p.submittedViaExtension,
          profileUsed: p.profileUsed,
          proposedRate: p.proposedRate,
          receivedRate: p.receivedRate,
          rateIncrease: p.rateIncrease,
          bidConnects: p.bidConnects,
          jobBudget: p.jobBudget,
          jobHoursPerWeek: p.jobHoursPerWeek,
          jobDuration: p.jobDuration,
          jobExperienceLevel: p.jobExperienceLevel,
          jobDescription: p.jobDescription,
          jobSkills: p.jobSkills,
          jobPostedDate: p.jobPostedDate,
          clientRating: p.clientRating,
          clientReviews: p.clientReviews,
          clientReviewScore: p.clientReviewScore,
          clientNote: p.clientNote,
          clientCity: p.clientCity,
          clientJobsPosted: p.clientJobsPosted,
          clientHireRate: p.clientHireRate,
          clientOpenJobs: p.clientOpenJobs,
          clientTotalSpent: p.clientTotalSpent,
          clientHires: p.clientHires,
          clientActiveHires: p.clientActiveHires,
          clientAvgRate: p.clientAvgRate,
          clientTotalHours: p.clientTotalHours,
          clientMemberSince: p.clientMemberSince,
          clientPaymentVerified: p.clientPaymentVerified,
          createdAt: p.createdAt,
          capturedBy: p.capturedByUser
            ? { id: p.capturedByUser.id, name: p.capturedByUser.name }
            : null,
          submittedBy: p.submittedByUser
            ? { id: p.submittedByUser.id, name: p.submittedByUser.name }
            : null,
        })),
        proposalCount: account.proposals.length,
        alertCounts: {
          messages: account.alerts.filter((a) => a.type === "message").length,
          invites: account.alerts.filter((a) => a.type === "invite").length,
          offers: account.alerts.filter((a) => a.type === "offer").length,
        },
        primaryOwnerId: account.primaryOwner?.id ?? null,
        primaryOwnerName: account.primaryOwner?.name ?? null,
      };
    });

    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[accounts]", message);
    return NextResponse.json({ error: "Failed to fetch accounts" }, { status: 500 });
  }
}
