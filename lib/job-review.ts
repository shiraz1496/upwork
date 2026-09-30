// Job review for a developer (handover Phase F): jobs from the developer's own Upwork
// connection, each annotated with which admin-configured criteria it matched. Deterministic:
// no scores, no ranking, Upwork's order is kept.

import { prisma } from "@/lib/prisma";
import { getBlockedTitlePatterns } from "@/lib/blocked-titles";
import {
  EMPTY_FACTS,
  evaluateJob,
  parseProposalRange,
  skillMatchCount,
  type JobEvaluation,
  type JobFacts,
  type ReviewConfig,
} from "@/lib/criteria";
import { DraftError } from "@/lib/proposals/drafts";
import type { ConnectionDeps } from "@/lib/upwork/connection";
import { findJobs } from "@/lib/upwork/jobs";
import type { JobDto } from "@/lib/upwork/normalize";

// What a job-search result tells us. Everything the search does not return stays null, so
// criteria on those fields (hire rate, active hires, interviewing, hires on this job, last
// viewed) come out "unknown" rather than being guessed.
export function factsFromJob(job: JobDto, freelancerSkills?: string[] | null): JobFacts {
  return {
    ...EMPTY_FACTS,
    clientTotalSpent: job.client.totalSpent,
    clientRating: job.client.rating,
    clientReviews: job.client.totalReviews,
    clientJobsPosted: job.client.totalPostedJobs,
    clientHires: job.client.totalHires,
    clientPaymentVerified: job.client.paymentVerified,
    clientCountry: job.client.country,
    jobProposals: parseProposalRange(job.proposalsTier),
    skillMatchCount: skillMatchCount(job.skills, freelancerSkills),
  };
}

// Admin-configured inputs. `accountId` (optional) selects that account's keywords and
// profile skills; both are admin/team configuration, not another member's private data.
export async function loadReviewConfig(accountId?: string | null): Promise<ReviewConfig & { freelancerSkills: string[] | null }> {
  const [criteria, blockedTitlePatterns, account] = await Promise.all([
    prisma.biddingCriterion.findMany({
      where: { active: true },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      select: { key: true, operator: true, value: true, required: true },
    }),
    getBlockedTitlePatterns("proposals"),
    accountId
      ? prisma.account.findUnique({
          where: { id: accountId },
          select: { keywords: { select: { text: true } }, profile: { select: { skills: true } } },
        })
      : null,
  ]);
  if (accountId && !account) throw new DraftError("account_not_found", 400, "accountId does not exist");
  return {
    criteria,
    blockedTitlePatterns,
    keywords: account?.keywords.map((k) => k.text) ?? [],
    freelancerSkills: account?.profile?.skills?.length ? account.profile.skills : null,
  };
}

export type ReviewedJob = JobDto & { evaluation: JobEvaluation };

export function reviewJobs(jobs: JobDto[], config: ReviewConfig & { freelancerSkills: string[] | null }): ReviewedJob[] {
  return jobs.map((job) => ({
    ...job,
    evaluation: evaluateJob(
      { title: job.title, descriptionSnippet: job.descriptionSnippet, skills: job.skills, facts: factsFromJob(job, config.freelancerSkills) },
      config,
    ),
  }));
}

export async function getReviewedJobs(
  memberId: string,
  action: "search" | "smart_search",
  params: Record<string, unknown>,
  accountId?: string | null,
  deps?: ConnectionDeps,
) {
  const result = await findJobs(memberId, action, params, deps);
  if (result.status === "disabled") return { ...result, jobs: null };
  const config = await loadReviewConfig(accountId);
  const { data, ...meta } = result;
  return { ...meta, jobs: reviewJobs(data, config) };
}

const REVIEW_DEDUPE_MS = 24 * 60 * 60 * 1000;

// "Jobs reviewed" metric: recorded when the developer opens a job in our app (APP_RECORDED).
// One entry per member + job per 24h so repeated opens don't inflate the number.
export async function logJobReview(memberId: string, upworkJobId: string, jobTitle?: string | null) {
  const recent = await prisma.jobReviewLog.findFirst({
    where: { memberId, upworkJobId, reviewedAt: { gte: new Date(Date.now() - REVIEW_DEDUPE_MS) } },
    select: { id: true },
  });
  if (recent) return { logged: false };
  await prisma.jobReviewLog.create({ data: { memberId, upworkJobId, jobTitle: jobTitle ?? null, source: "APP_RECORDED" } });
  return { logged: true };
}
