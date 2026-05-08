import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAttribution, resolveAccount } from "@/lib/attribution";

type Payload = {
  freelancerId: string;
  name?: string | null;
  title?: string | null;
  photoUrl?: string | null;
  location?: string | null;
  hourlyRate?: string | null;
  totalEarnings?: string | null;
  totalJobs?: number | null;
  totalHours?: number | null;
  overview?: string | null;
  skills?: string[];
};

export const POST = withAttribution(async ({ req, member }) => {
  try {
    const body = (await req.json()) as Payload;
    if (!body.freelancerId) {
      return NextResponse.json({ error: "freelancerId required" }, { status: 400 });
    }

    const account = await resolveAccount(body.freelancerId, body.name ?? null);
    if (!account) {
      return NextResponse.json({ error: "could not resolve account" }, { status: 500 });
    }

    const now = new Date();
    const data = {
      title: body.title ?? null,
      photoUrl: body.photoUrl ?? null,
      location: body.location ?? null,
      hourlyRate: body.hourlyRate ?? null,
      totalEarnings: body.totalEarnings ?? null,
      totalJobs: body.totalJobs ?? null,
      totalHours: body.totalHours ?? null,
      overview: body.overview ?? null,
      skills: Array.isArray(body.skills) ? body.skills.slice(0, 200) : [],
      capturedAt: now,
      capturedByUserId: member.id,
    };

    const profile = await prisma.freelancerProfile.upsert({
      where: { accountId: account.id },
      update: data,
      create: { accountId: account.id, ...data },
    });

    return NextResponse.json({
      ok: true,
      profileId: profile.id,
      accountId: account.id,
      member: { id: member.id, name: member.name },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[sync/freelancer-profile]", message);
    return NextResponse.json({ error: "Failed to sync freelancer profile" }, { status: 500 });
  }
});
