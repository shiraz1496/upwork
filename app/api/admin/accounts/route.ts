import { prisma } from "@/lib/prisma";
import { requireAdmin, adminErrorResponse } from "@/lib/admin-auth";

export async function GET() {
  try {
    await requireAdmin();

    const [accounts, bidders, propPairs, snapPairs, alertPairs] = await Promise.all([
      prisma.account.findMany({
        orderBy: { name: "asc" },
        include: { primaryOwner: { select: { id: true, name: true } } },
      }),
      prisma.teamMember.findMany({
        where: { role: "bidder" },
        orderBy: [{ status: "asc" }, { name: "asc" }],
        select: { id: true, name: true, email: true, status: true },
      }),
      prisma.proposal.findMany({
        where: { capturedByUserId: { not: null } },
        distinct: ["accountId", "capturedByUserId"],
        select: { accountId: true, capturedByUserId: true },
      }),
      prisma.snapshot.findMany({
        where: { capturedByUserId: { not: null } },
        distinct: ["accountId", "capturedByUserId"],
        select: { accountId: true, capturedByUserId: true },
      }),
      prisma.alert.findMany({
        where: { capturedByUserId: { not: null } },
        distinct: ["accountId", "capturedByUserId"],
        select: { accountId: true, capturedByUserId: true },
      }),
    ]);

    const capturers = new Map<string, Set<string>>();
    for (const r of [...propPairs, ...snapPairs, ...alertPairs]) {
      if (!r.capturedByUserId) continue;
      let set = capturers.get(r.accountId);
      if (!set) {
        set = new Set();
        capturers.set(r.accountId, set);
      }
      set.add(r.capturedByUserId);
    }

    const result = accounts.map((a) => ({
      id: a.id,
      name: a.name,
      freelancerId: a.freelancerId,
      primaryOwnerId: a.primaryOwner?.id ?? null,
      primaryOwnerName: a.primaryOwner?.name ?? null,
      capturerIds: Array.from(capturers.get(a.id) ?? []),
    }));

    return Response.json({ accounts: result, bidders });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
