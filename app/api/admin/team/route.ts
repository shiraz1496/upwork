import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin, adminErrorResponse } from "@/lib/admin-auth";

export async function GET() {
  try {
    await requireAdmin();
    const members = await prisma.teamMember.findMany({
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
      include: {
        tokens: {
          where: { revokedAt: null },
          select: { id: true, label: true, lastUsedAt: true, createdAt: true },
        },
        _count: { select: { tokens: true } },
        // Status only — an admin can see whether a bidder is connected, never the tokens,
        // and cannot change the connection (handover §10.2).
        upworkConnection: { select: { status: true, accountName: true, lastSyncedAt: true } },
      },
    });
    return Response.json({ members });
  } catch (err) {
    return adminErrorResponse(err);
  }
}

const CreateBody = z.object({
  name: z.string().min(1).max(120),
  // Stored lower-case: login ignores case, so "Bob@x.com" and "bob@x.com" are one person.
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(["admin", "bidder"]).default("bidder"),
});

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = CreateBody.parse(await req.json());

    // Older rows may be stored with capitals, which the unique index does not catch.
    const taken = await prisma.teamMember.findFirst({
      where: { email: { equals: body.email, mode: "insensitive" } },
      select: { id: true },
    });
    if (taken) return Response.json({ error: "email_taken", detail: "A team member with this email already exists." }, { status: 409 });

    const member = await prisma.teamMember.create({ data: body });
    return Response.json({ member });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return Response.json({ error: "invalid", issues: err.issues }, { status: 400 });
    }
    return adminErrorResponse(err);
  }
}
