import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveMeSession, authErrorResponse } from "@/lib/me-auth";
import { accountsWithNewPipelineData, memberAccount, submissionProvenanceByJobUrl, unavailableMetrics, upworkIdsWithHiredSource } from "@/lib/dashboard-feed";

export async function GET(req: NextRequest) {
  try {
    const { member } = await resolveMeSession(req);

    // The bidder's own account, plus accounts they have proposals or alerts on — not
    // every account in the system.
    const own = await memberAccount(member);
    const accounts = await prisma.account.findMany({
      where: {
        OR: [
          { id: own.id },
          { proposals: { some: { capturedByUserId: member.id } } },
          { alerts: { some: { capturedByUserId: member.id } } },
        ],
      },
      include: {
        profile: { include: { capturedByUser: { select: { id: true, name: true } } } },
        proposals: {
          where: { capturedByUserId: member.id },
          orderBy: { createdAt: "desc" },
          take: 100,
          include: {
            capturedByUser: { select: { id: true, name: true } },
            submittedByUser: { select: { id: true, name: true } },
          },
        },
        alerts: {
          where: { capturedByUserId: member.id, read: false },
          orderBy: { createdAt: "desc" },
          take: 50,
          include: { capturedByUser: { select: { id: true, name: true } } },
        },
      },
    });

    const [newPipeline, provenance, hiredSource] = await Promise.all([
      accountsWithNewPipelineData(accounts.map((a) => a.id)),
      submissionProvenanceByJobUrl({ memberId: member.id }),
      upworkIdsWithHiredSource(accounts.map((a) => a.freelancerId)),
    ]);

    const result = accounts.map((account) => {
      return {
        metricsUnavailable: newPipeline.has(account.id) ? unavailableMetrics(hiredSource.has(account.freelancerId)) : [],
        isDisabled: account.isDisabled,
        disabledReason: account.disabledReason ?? null,
        id: account.id,
        freelancerId: account.freelancerId,
        name: account.name,
        jss: account.jss,
        connectsBalance: account.connectsBalance,
        createdAt: account.createdAt,
        proposals: account.proposals.map((p) => ({
          id: p.id,
          provenance: provenance.get(`${account.id}|${p.jobUrl}`) ?? null,
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
          clientCompany: p.clientCompany,
          hiredAt: p.hiredAt,
          contractEndedAt: p.contractEndedAt,
          contractStatus: p.contractStatus,
          contractRating: p.contractRating,
          contractBudget: p.contractBudget,
          contractRate: p.contractRate,
          contractWeeklyLimit: p.contractWeeklyLimit,
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
        profile: account.profile
          ? {
              title: account.profile.title,
              photoUrl: account.profile.photoUrl,
              location: account.profile.location,
              hourlyRate: account.profile.hourlyRate,
              totalEarnings: account.profile.totalEarnings,
              totalJobs: account.profile.totalJobs,
              totalHours: account.profile.totalHours,
              overview: account.profile.overview,
              skills: account.profile.skills,
              capturedAt: account.profile.capturedAt,
              updatedAt: account.profile.updatedAt,
              capturedBy: account.profile.capturedByUser
                ? { id: account.profile.capturedByUser.id, name: account.profile.capturedByUser.name }
                : null,
            }
          : null,
      };
    });

    return Response.json(result);
  } catch (err) {
    return authErrorResponse(err);
  }
}
