// Who is on the other end of a connection, and guards so a member only ever uses their own.

import type { McpClient } from "@/lib/upwork/client";
import { normalizeAccounts, toolPayload } from "@/lib/upwork/normalize";
import { ForbiddenError } from "@/lib/member-auth";
import { prisma } from "@/lib/prisma";

export type Identity = { upworkAccountId: string | null; name: string | null };

// list_accounts returns every account the login can act as (Freelancer = TALENT, Agency =
// FL_AGENCY, Client). We connect the freelancer account; its org_uid is required by every
// other tool call and is what we store as upworkAccountId.
export async function fetchIdentity(client: McpClient): Promise<Identity> {
  const accounts = normalizeAccounts(toolPayload(await client.callTool("list_accounts")));
  const freelancer = accounts.find((a) => a.role === "TALENT");
  return { upworkAccountId: freelancer?.orgUid ?? null, name: freelancer?.name ?? null };
}

// A member's tokens are used only for that member's calls (handover §10.3).
export function assertOwnConnection(connection: { memberId: string }, memberId: string): void {
  if (connection.memberId !== memberId) throw new ForbiddenError();
}

// One Upwork account ↔ one member: refuse if another member already connected the same
// Upwork account (that would be sharing an account, handover §1 guardrail 3).
export async function assertAccountNotClaimed(upworkAccountId: string, memberId: string): Promise<void> {
  const other = await prisma.upworkConnection.findFirst({
    where: { upworkAccountId, memberId: { not: memberId }, status: "connected" },
    select: { id: true },
  });
  if (other) throw new ForbiddenError();
}
