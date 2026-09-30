import { withMcp, type ConnectionDeps } from "@/lib/upwork/connection";
import { normalizeConnectsBalance, normalizeProfile, toolPayload, type ProfileDto } from "@/lib/upwork/normalize";
import { disabledResult, isLive, ok, type ServiceResult } from "@/lib/upwork/result";

export type OwnProfile = { profile: ProfileDto; connectsBalance: number | null };

// The member's own freelancer profile and Connects balance (get_profile). Read only.
export async function getOwnProfile(memberId: string, deps?: ConnectionDeps): Promise<ServiceResult<OwnProfile>> {
  if (!isLive()) return disabledResult;
  return ok(
    await withMcp(
      memberId,
      async (c, orgUid) => ({
        profile: normalizeProfile(toolPayload(await c.callTool("get_profile", { action: "get", org_uid: orgUid }))),
        connectsBalance: normalizeConnectsBalance(
          toolPayload(await c.callTool("get_profile", { action: "connects_balance", org_uid: orgUid })),
        ),
      }),
      deps,
    ),
  );
}
