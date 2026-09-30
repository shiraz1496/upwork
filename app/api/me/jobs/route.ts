import { NextRequest } from "next/server";
import { z } from "zod";
import { requireDeveloper } from "@/lib/me-auth";
import { memberAccount } from "@/lib/dashboard-feed";
import { getReviewedJobs } from "@/lib/job-review";
import { proposalRouteError } from "@/lib/proposals/http";
import { DISABLED_DETAIL } from "@/lib/upwork/flags";

// Only these options are passed on to Upwork — never arbitrary client input.
const Query = z
  .object({
    // search = the developer's own filters; best_match / most_recent = Upwork's feed for them.
    mode: z.enum(["search", "best_match", "most_recent"]).default("best_match"),
    title: z.string().trim().min(1).max(100).optional(),
    query: z.string().trim().min(1).max(200).optional(),
    skills: z
      .string()
      .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean))
      .pipe(z.array(z.string().max(60)).min(1).max(5))
      .optional(),
    job_type: z.enum(["fixed", "hourly"]).optional(),
    experience_level: z.enum(["entry_level", "intermediate", "expert"]).optional(),
    verified_payment_only: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
    days_posted: z.coerce.number().int().min(1).max(30).optional(),
    limit: z.coerce.number().int().min(1).max(10).default(10),
    cursor: z.string().max(200).optional(),
  })
  .refine((q) => !(q.title && q.query), { message: "use title or query, not both" });

// Jobs from the developer's OWN Upwork connection, each with the admin-configured criteria
// it matched. Deterministic; no scores, no ranking. Flag off → { status: "disabled" }.
export async function GET(req: NextRequest) {
  try {
    const member = await requireDeveloper();
    const q = Query.parse(Object.fromEntries(new URL(req.url).searchParams));

    const common = { limit: q.limit, cursor: q.cursor, verified_payment_only: q.verified_payment_only };
    const [action, params] =
      q.mode === "search"
        ? (["search", { ...common, title: q.title, query: q.query, skills: q.skills, job_type: q.job_type, experience_level: q.experience_level }] as const)
        : (["smart_search", { ...common, mode: q.mode, days_posted: q.mode === "most_recent" ? q.days_posted : undefined }] as const);
    // Drop unset options so Upwork only sees what was asked for.
    const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined));

    // Keywords and profile skills always come from the bidder's OWN account — never an
    // account id sent by the client.
    const accountId = (await memberAccount(member)).id;
    const result = await getReviewedJobs(member.id, action, clean, accountId);
    if (result.status === "disabled") return Response.json({ status: "disabled", detail: DISABLED_DETAIL, jobs: null });
    return Response.json(result);
  } catch (err) {
    return proposalRouteError(err);
  }
}
