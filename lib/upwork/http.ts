import { authErrorResponse } from "@/lib/me-auth";
import { UpworkError, upworkErrorResponse } from "@/lib/upwork/errors";

// Route-level error mapping for /api/me/upwork/*: Upwork errors → safe JSON, auth errors → 401/403.
export function upworkRouteError(err: unknown): Response {
  if (err instanceof UpworkError) return upworkErrorResponse(err);
  return authErrorResponse(err);
}
