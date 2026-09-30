import { requireDeveloper } from "@/lib/me-auth";
import { syncProfile } from "@/lib/dashboard-feed";
import { syncProposalOutcomes } from "@/lib/proposals/drafts";
import { syncClientResponses } from "@/lib/responses";
import { UpworkError } from "@/lib/upwork/errors";
import { DISABLED_DETAIL, mcpEnabled, mockMode } from "@/lib/upwork/flags";
import { upworkRouteError } from "@/lib/upwork/http";

type Failed = { status: "error"; error: string; detail: string };

// An Upwork problem in one part is reported for that part; the other parts still run.
async function part<T>(run: () => Promise<T>): Promise<T | Failed> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof UpworkError) return { status: "error", error: err.code, detail: err.message };
    throw err;
  }
}

// "Refresh activity": the bidder asks for a fresh read of their OWN Upwork profile, Connects
// balance, the outcome of their submitted proposals, and client replies. User-triggered
// only — never scheduled (handover §1 guardrail 4).
export async function POST() {
  try {
    const member = await requireDeveloper();
    if (!mcpEnabled() && !mockMode()) return Response.json({ status: "disabled", detail: DISABLED_DETAIL });

    const profile = await part(() => syncProfile(member));
    const proposals = await part(() => syncProposalOutcomes(member));
    const responses = await part(() => syncClientResponses(member));
    return Response.json({ status: "ok", profile, proposals, responses });
  } catch (err) {
    return upworkRouteError(err);
  }
}
