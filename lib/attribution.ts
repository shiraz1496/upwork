import type { NextRequest } from "next/server";
import type { TeamMember } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveExtensionToken, AuthError, authErrorResponse } from "@/lib/member-auth";

export type AttributionContext = {
  req: NextRequest;
  member: TeamMember;
  tokenId: string;
};

export function withAttribution(
  handler: (ctx: AttributionContext) => Promise<Response>,
): (req: NextRequest) => Promise<Response> {
  return async (req: NextRequest) => {
    try {
      const { member, tokenId } = await resolveExtensionToken(req);
      return await handler({ req, member, tokenId });
    } catch (err) {
      if (err instanceof AuthError) return authErrorResponse(err);
      console.error("[attribution]", err);
      return Response.json({ error: "internal" }, { status: 500 });
    }
  };
}

export function firstCaptureFields(member: TeamMember) {
  return { capturedByUserId: member.id, capturedAt: new Date() };
}

export async function resolveAccount(freelancerId: string, fallbackName?: string | null) {
  const fid = String(freelancerId);
  let account = await prisma.account.findUnique({ where: { freelancerId: fid } });
  if (account) return account;
  try {
    account = await prisma.account.create({
      data: { freelancerId: fid, name: fallbackName || fid },
    });
    return account;
  } catch {
    return prisma.account.findUnique({ where: { freelancerId: fid } });
  }
}
