import { withMcp, type ConnectionDeps } from "@/lib/upwork/connection";
import { normalizeAccounts, toolPayload, type UpworkAccountDto } from "@/lib/upwork/normalize";
import { disabledResult, isLive, ok, type ServiceResult } from "@/lib/upwork/result";

// Every account the member's own Upwork login can act as (freelancer / agency / client).
export async function listAccounts(memberId: string, deps?: ConnectionDeps): Promise<ServiceResult<UpworkAccountDto[]>> {
  if (!isLive()) return disabledResult;
  return ok(await withMcp(memberId, async (c) => normalizeAccounts(toolPayload(await c.callTool("list_accounts"))), deps));
}
