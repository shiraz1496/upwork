import { NextRequest } from "next/server";
import { resolveExtensionToken, authErrorResponse } from "@/lib/member-auth";

export async function POST(req: NextRequest) {
  try {
    const { member } = await resolveExtensionToken(req);
    return Response.json({
      member: { id: member.id, name: member.name, email: member.email, role: member.role },
    });
  } catch (err) {
    return authErrorResponse(err);
  }
}
