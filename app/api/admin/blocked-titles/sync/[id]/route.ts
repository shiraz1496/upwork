import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, adminErrorResponse } from "@/lib/admin-auth";

// Per-row delete used by the scan results UI so the user can prune individual
// stored proposal/contract rows instead of deleting every match at once.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin();
    const { id } = await params;
    await prisma.proposal.delete({ where: { id } });
    return Response.json({ ok: true });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
