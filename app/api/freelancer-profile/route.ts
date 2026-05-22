import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveExtensionToken, authErrorResponse } from "@/lib/member-auth";

export async function GET(req: NextRequest) {
  try {
    await resolveExtensionToken(req);
    const freelancerId = req.nextUrl.searchParams.get("freelancerId");
    if (!freelancerId) return Response.json({ profile: null });

    const account = await prisma.account.findUnique({
      where: { freelancerId },
      select: {
        name: true,
        jss: true,
        connectsBalance: true,
        profile: {
          select: {
            title: true,
            hourlyRate: true,
            location: true,
            totalJobs: true,
            totalHours: true,
            totalEarnings: true,
            overview: true,
            skills: true,
            capturedAt: true,
          },
        },
      },
    });

    if (!account) return Response.json({ profile: null });

    return Response.json({
      profile: {
        name: account.name,
        jss: account.jss,
        connectsBalance: account.connectsBalance,
        ...account.profile,
      },
    });
  } catch (err) {
    return authErrorResponse(err);
  }
}
