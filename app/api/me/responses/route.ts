import { requireDeveloper } from "@/lib/me-auth";
import { proposalRouteError } from "@/lib/proposals/http";
import { listResponses, serializeResponse } from "@/lib/responses";

// The developer's own client responses. needsManualAssociation = not linked to a proposal.
export async function GET() {
  try {
    const member = await requireDeveloper();
    const responses = await listResponses(member);
    return Response.json({ responses: responses.map(serializeResponse) });
  } catch (err) {
    return proposalRouteError(err);
  }
}
