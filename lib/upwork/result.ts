// Common envelope for Upwork service results. Provenance travels with the data so the
// UI can label it; flag-off returns "disabled" with no data — never fabricated values.

import { mcpEnabled, mockMode } from "@/lib/upwork/flags";

export type ServiceResult<T> =
  | { status: "disabled"; provenance: null; data: null }
  | { status: "ok"; provenance: "MCP_VERIFIED" | "MOCK"; retrievedAt: string; data: T };

export const disabledResult = { status: "disabled", provenance: null, data: null } as const;

export function isLive(): boolean {
  return mcpEnabled() || mockMode();
}

export function ok<T>(data: T): ServiceResult<T> {
  return {
    status: "ok",
    // Mock (local-dev) data must never pass as verified.
    provenance: mockMode() ? "MOCK" : "MCP_VERIFIED",
    retrievedAt: new Date().toISOString(),
    data,
  };
}
