import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      freelancerId, url, title, description, budget, jobType, category,
      skills, experienceLevel, projectType, contractToHire,
      clientPaymentVerified, clientPhoneVerified,
      clientRating, clientReviewScore, clientReviews,
      clientSpent, clientCountry, clientCity,
      clientHires, clientActiveHires, clientHireRate, clientOpenJobs,
      clientJobsPosted, clientMemberSince,
      clientIndustry, clientCompanySize,
      jobLocation, connectsRequired, postedTime,
    } = body;

    if (!freelancerId || !url || !title) {
      return NextResponse.json({ error: "freelancerId, url, and title required" }, { status: 400 });
    }

    // Clean the URL (remove query params)
    const cleanUrl = url.split("?")[0];

    let account = await prisma.account.findUnique({ where: { freelancerId: String(freelancerId) } });
    if (!account) {
      try {
        account = await prisma.account.create({
          data: { freelancerId: String(freelancerId), name: String(freelancerId) },
        });
      } catch {
        account = await prisma.account.findUnique({ where: { freelancerId: String(freelancerId) } });
      }
    }
    if (!account) {
      return NextResponse.json({ error: "Failed to resolve account" }, { status: 500 });
    }

    const data = {
      title,
      description: description ?? null,
      budget: budget ?? null,
      jobType: jobType ?? null,
      category: category ?? null,
      skills: Array.isArray(skills) ? skills : [],
      experienceLevel: experienceLevel ?? null,
      projectType: projectType ?? null,
      contractToHire: contractToHire ?? false,
      clientPaymentVerified: clientPaymentVerified ?? false,
      clientPhoneVerified: clientPhoneVerified ?? false,
      clientRating: clientRating ? Number(clientRating) : null,
      clientReviewScore: clientReviewScore ?? null,
      clientReviews: clientReviews ? Number(clientReviews) : null,
      clientSpent: clientSpent ?? null,
      clientCountry: clientCountry ?? null,
      clientCity: clientCity ?? null,
      clientHires: clientHires ? Number(clientHires) : null,
      clientActiveHires: clientActiveHires ? Number(clientActiveHires) : null,
      clientHireRate: clientHireRate ? Number(clientHireRate) : null,
      clientOpenJobs: clientOpenJobs ? Number(clientOpenJobs) : null,
      clientJobsPosted: clientJobsPosted ? Number(clientJobsPosted) : null,
      clientMemberSince: clientMemberSince ?? null,
      clientIndustry: clientIndustry ?? null,
      clientCompanySize: clientCompanySize ?? null,
      jobLocation: jobLocation ?? null,
      connectsRequired: connectsRequired ? Number(connectsRequired) : null,
      postedTime: postedTime ?? null,
      viewedAt: new Date(),
    };

    const job = await prisma.job.upsert({
      where: { accountId_url: { accountId: account.id, url: cleanUrl } },
      update: data,
      create: { accountId: account.id, url: cleanUrl, ...data },
    });

    return NextResponse.json({ ok: true, jobId: job.id });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[sync/job]", message);
    return NextResponse.json({ error: "Failed to sync job" }, { status: 500 });
  }
}
