import { withMcp, type ConnectionDeps } from "@/lib/upwork/connection";
import { normalizeContracts, toolPayload, type ContractDto } from "@/lib/upwork/normalize";
import { disabledResult, isLive, ok, type ServiceResult } from "@/lib/upwork/result";

// list_contracts action=search: the member's own contracts (freelancer side).
export async function listContracts(
  memberId: string,
  params: Record<string, unknown> = {},
  deps?: ConnectionDeps,
): Promise<ServiceResult<ContractDto[]>> {
  if (!isLive()) return disabledResult;
  return ok(
    await withMcp(
      memberId,
      async (c, orgUid) =>
        normalizeContracts(toolPayload(await c.callTool("list_contracts", { action: "search", org_uid: orgUid, params }))),
      deps,
    ),
  );
}
