import { withMcp, type ConnectionDeps } from "@/lib/upwork/connection";
import { UpworkError } from "@/lib/upwork/errors";
import { jobIdKey } from "@/lib/upwork/ids";
import { normalizeProposalDetail, normalizeProposals, toolPayload, type ProposalDto } from "@/lib/upwork/normalize";
import { disabledResult, isLive, ok, type ServiceResult } from "@/lib/upwork/result";

// READ ONLY. This app never drafts or submits proposals through MCP.

// list_freelancer_proposals action=list. Status "Accepted" means SUBMITTED on Upwork (not
// accepted by the client).
export async function listSubmittedProposals(
  memberId: string,
  params: Record<string, unknown> = {},
  deps?: ConnectionDeps,
): Promise<ServiceResult<ProposalDto[]>> {
  if (!isLive()) return disabledResult;
  return ok(
    await withMcp(
      memberId,
      async (c, orgUid) =>
        normalizeProposals(
          toolPayload(
            await c.callTool("list_freelancer_proposals", {
              action: "list",
              org_uid: orgUid,
              params: { status: "Accepted", ...params },
            }),
          ),
        ),
      deps,
    ),
  );
}

// A proposal that was really submitted shows up on Upwork under one of these statuses.
// Order matters: the first status a job is found under wins, and the later ones mean it
// progressed (offer, hire) or ended (job closed, declined, withdrawn).
const STATUSES_TO_SEARCH = ["Hired", "Offered", "Accepted", "Archived", "Declined", "Withdrawn"] as const;

export type FoundProposal = { proposal: ProposalDto; roomId: string | null };

// Looks up the member's own proposals for the given jobs: the official proof that a
// proposal was submitted, what happened to it (Offered / Hired / …) and — with
// `withRooms` — the message room Upwork links to it. Checks the newest page (10) of each
// status and stops as soon as every job is found. Jobs that are not found are left out.
export async function proposalsForJobs(
  memberId: string,
  jobKeys: string[],
  opts: { withRooms?: boolean } = {},
  deps?: ConnectionDeps,
): Promise<ServiceResult<Map<string, FoundProposal>>> {
  if (!isLive()) return disabledResult;
  const wanted = new Set(jobKeys);
  return ok(
    await withMcp(
      memberId,
      async (c, orgUid) => {
        const found = new Map<string, FoundProposal>();
        if (wanted.size === 0) return found;

        for (const status of STATUSES_TO_SEARCH) {
          if (found.size === wanted.size) break;
          const rows = normalizeProposals(
            toolPayload(await c.callTool("list_freelancer_proposals", { action: "list", org_uid: orgUid, params: { status } })),
          );
          for (const p of rows) {
            if (!p.upworkJobId) continue;
            const key = jobIdKey(p.upworkJobId);
            if (wanted.has(key) && !found.has(key)) found.set(key, { proposal: p, roomId: null });
          }
        }

        if (opts.withRooms) {
          for (const entry of found.values()) {
            try {
              const detail = normalizeProposalDetail(
                toolPayload(
                  await c.callTool("list_freelancer_proposals", {
                    action: "get",
                    org_uid: orgUid,
                    params: { id: entry.proposal.upworkProposalId },
                  }),
                ),
              );
              entry.roomId = detail.roomId;
            } catch (err) {
              // No detail for this proposal: it simply has no verified room link.
              if (!(err instanceof UpworkError)) throw err;
            }
          }
        }
        return found;
      },
      deps,
    ),
  );
}
