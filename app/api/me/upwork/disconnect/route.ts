import { requireDeveloper } from "@/lib/me-auth";
import { disconnect, getConnection, publicStatus } from "@/lib/upwork/connection";
import { upworkRouteError } from "@/lib/upwork/http";

// Revokes (where supported) and clears the bidder's Upwork tokens. Their saved proposals
// and their login to this app are not affected.
export async function POST() {
  try {
    const member = await requireDeveloper();
    await disconnect(member.id);
    return Response.json({ ok: true, ...publicStatus(await getConnection(member.id)) });
  } catch (err) {
    return upworkRouteError(err);
  }
}
