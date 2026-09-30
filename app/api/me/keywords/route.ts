import { prisma } from "@/lib/prisma";
import { resolveMeSession, authErrorResponse } from "@/lib/me-auth";
import { memberAccount } from "@/lib/dashboard-feed";

// Keywords of the bidder's OWN account. (This used to take a freelancerId from the client,
// which let a bidder read any account's keywords.)
export async function GET() {
  try {
    const { member } = await resolveMeSession();
    const account = await memberAccount(member);
    const keywords = await prisma.accountKeyword.findMany({
      where: { accountId: account.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, text: true },
    });
    return Response.json({ keywords });
  } catch (err) {
    return authErrorResponse(err);
  }
}
