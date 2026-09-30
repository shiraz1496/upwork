import { NextRequest } from "next/server";
import { z } from "zod";
import { requireDeveloper } from "@/lib/me-auth";
import { CreateDraftBody, createDraft, listDrafts, serializeDraft } from "@/lib/proposals/drafts";
import { proposalRouteError, readJson } from "@/lib/proposals/http";
import { repairProposalRows } from "@/lib/dashboard-feed";
import { logError } from "@/lib/log";

const StateQuery = z.enum(["DRAFT", "READY", "SUBMISSION_UNVERIFIED", "SUBMITTED_CONFIRMED"]).optional();

// The developer's own proposal drafts (scoped by the session, never by a client-sent id).
export async function GET(req: NextRequest) {
  try {
    const member = await requireDeveloper();
    const state = StateQuery.parse(new URL(req.url).searchParams.get("state") ?? undefined);
    const drafts = await listDrafts(member, state);
    // A recorded submission whose dashboard copy is missing is put back here.
    await repairProposalRows(member.id).catch((err) => logError("proposal repair", err));
    return Response.json({ proposals: drafts.map(serializeDraft) });
  } catch (err) {
    return proposalRouteError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const member = await requireDeveloper();
    const body = CreateDraftBody.parse(await readJson(req));
    const draft = await createDraft(member, body);
    return Response.json({ proposal: serializeDraft(draft) }, { status: 201 });
  } catch (err) {
    return proposalRouteError(err);
  }
}
