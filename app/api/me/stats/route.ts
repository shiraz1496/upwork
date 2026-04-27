import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveMeSession, authErrorResponse } from "@/lib/me-auth";

function windowStart(daysAgo: number): Date {
  return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
}

async function computeStats(memberId: string, fromDate: Date, toDate: Date) {
  // Use submittedAt for the time window — that's when the proposal was actually sent,
  // not when the extension happened to sync it. Fall back to capturedAt when submittedAt
  // is null so nothing is silently excluded.
  const proposalWhere = {
    capturedByUserId: memberId,
    OR: [
      { submittedAt: { gte: fromDate, lt: toDate } },
      { submittedAt: null, capturedAt: { gte: fromDate, lt: toDate } },
    ],
  };

  const alertWhere = {
    capturedByUserId: memberId,
    capturedAt: { gte: fromDate, lt: toDate },
  };

  const [sent, viewed, interviewed, hired, messagesCaptured, messagesReplied] = await Promise.all([
    prisma.proposal.count({ where: proposalWhere }),
    prisma.proposal.count({ where: { ...proposalWhere, viewedByClient: true } }),
    prisma.proposal.count({
      where: {
        ...proposalWhere,
        OR: [
          { section: { contains: "nterview", mode: "insensitive" } },
          { section: { contains: "offer", mode: "insensitive" } },
        ],
      },
    }),
    prisma.proposal.count({
      where: {
        ...proposalWhere,
        OR: [
          { status: { contains: "hired", mode: "insensitive" } },
          { section: { contains: "hired", mode: "insensitive" } },
        ],
      },
    }),
    prisma.alert.count({ where: { ...alertWhere, type: "message" } }),
    prisma.alert.count({ where: { ...alertWhere, type: "message", freelancerReplied: true } }),
  ]);

  const rate = (n: number) => (sent === 0 ? 0 : Math.round((n / sent) * 1000) / 10);

  return {
    sent,
    viewed,
    interviewed,
    hired,
    viewRate: rate(viewed),
    interviewRate: rate(interviewed),
    hireRate: rate(hired),
    messages: { captured: messagesCaptured, replied: messagesReplied },
  };
}

export async function GET(req: NextRequest) {
  try {
    const { member } = await resolveMeSession(req);

    const now = new Date();
    const last30 = await computeStats(member.id, windowStart(30), now);
    const last7 = await computeStats(member.id, windowStart(7), now);
    const prev7 = await computeStats(member.id, windowStart(14), windowStart(7));

    return Response.json({
      member: { id: member.id, name: member.name },
      windows: { last30, last7, prev7 },
    });
  } catch (err) {
    return authErrorResponse(err);
  }
}
