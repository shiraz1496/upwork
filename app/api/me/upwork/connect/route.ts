import { requireDeveloper } from "@/lib/me-auth";
import { startAuth } from "@/lib/upwork/connection";
import { upworkRouteError } from "@/lib/upwork/http";

// Starts the OAuth flow for the logged-in bidder's OWN Upwork account.
export async function POST() {
  try {
    const member = await requireDeveloper();
    const { authorizeUrl } = await startAuth(member.id);
    return Response.json({ authorizeUrl });
  } catch (err) {
    return upworkRouteError(err);
  }
}
