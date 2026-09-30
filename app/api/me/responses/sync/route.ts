import { requireDeveloper } from "@/lib/me-auth";
import { proposalRouteError } from "@/lib/proposals/http";
import { syncClientResponses } from "@/lib/responses";
import { DISABLED_DETAIL } from "@/lib/upwork/flags";

// "Refresh activity": user-triggered read of the developer's own Upwork message rooms.
// Never scheduled (handover §1 guardrail 4). Flag off → { status: "disabled" }.
export async function POST() {
  try {
    const member = await requireDeveloper();
    const result = await syncClientResponses(member);
    if (result.status === "disabled") return Response.json({ status: "disabled", detail: DISABLED_DETAIL });
    return Response.json(result);
  } catch (err) {
    return proposalRouteError(err);
  }
}
