import { z } from "zod";
import { authErrorResponse } from "@/lib/me-auth";
import { DraftError } from "@/lib/proposals/drafts";
import { UpworkError, upworkErrorResponse } from "@/lib/upwork/errors";

const FIELD_LABELS: Record<string, string> = {
  jobUrl: "The job link",
  jobTitle: "The job title",
  coverLetter: "The cover letter",
  proposedRate: "The rate",
  fixedBidAmount: "The amount",
  upworkJobId: "The job id",
};

// Error mapping for /api/me/proposals/*.
export function proposalRouteError(err: unknown): Response {
  if (err instanceof z.ZodError) {
    // `detail` is a sentence a person can act on; `issues` keeps the full list.
    const first = err.issues[0];
    const field = FIELD_LABELS[String(first?.path[0] ?? "")];
    const message = first && /received undefined|received null/.test(first.message) ? "is required" : first?.message;
    const detail = first ? (field ? `${field} ${message}` : `${message}`) : "The request is not valid";
    return Response.json({ error: "invalid", detail, issues: err.issues }, { status: 400 });
  }
  if (err instanceof DraftError) {
    return Response.json({ error: err.code, detail: err.message }, { status: err.httpStatus });
  }
  if (err instanceof UpworkError) return upworkErrorResponse(err);
  return authErrorResponse(err);
}

// Empty body is fine for POST actions that only take an optional note.
export async function readJson(req: Request): Promise<unknown> {
  const text = await req.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new z.ZodError([{ code: "custom", path: [], message: "body must be JSON", input: undefined }]);
  }
}
