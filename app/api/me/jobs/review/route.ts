import { NextRequest } from "next/server";
import { z } from "zod";
import { requireDeveloper } from "@/lib/me-auth";
import { logJobReview } from "@/lib/job-review";
import { jobIdKey } from "@/lib/proposals/drafts";
import { proposalRouteError, readJson } from "@/lib/proposals/http";

const Body = z.object({
  upworkJobId: z.string().trim().min(1).max(64),
  jobTitle: z.string().trim().max(300).optional(),
});

// Recorded when the developer opens a job inside our app. This replaces tracking what
// they browse on upwork.com: it only knows about actions taken here (APP_RECORDED).
export async function POST(req: NextRequest) {
  try {
    const member = await requireDeveloper();
    const body = Body.parse(await readJson(req));
    const result = await logJobReview(member.id, jobIdKey(body.upworkJobId), body.jobTitle);
    return Response.json({ ok: true, ...result });
  } catch (err) {
    return proposalRouteError(err);
  }
}
