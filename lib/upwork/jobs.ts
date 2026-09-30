import { withMcp, type ConnectionDeps } from "@/lib/upwork/connection";
import { normalizeJobs, toolPayload, type JobDto } from "@/lib/upwork/normalize";
import { disabledResult, isLive, ok, type ServiceResult } from "@/lib/upwork/result";

// find_jobs actions (verified 2026-09-30):
//   search        — the member's own filters (title/query/skills/job_type/rates…), limit 1–10
//   smart_search  — Upwork's recommendation feed for this freelancer (mode best_match | most_recent)
// `params` are passed through unchanged; see the tool's own help for the full list.
export async function findJobs(
  memberId: string,
  action: "search" | "smart_search",
  params: Record<string, unknown> = {},
  deps?: ConnectionDeps,
): Promise<ServiceResult<JobDto[]>> {
  if (!isLive()) return disabledResult;
  return ok(
    await withMcp(
      memberId,
      async (c, orgUid) => normalizeJobs(toolPayload(await c.callTool("find_jobs", { action, org_uid: orgUid, params }))),
      deps,
    ),
  );
}
