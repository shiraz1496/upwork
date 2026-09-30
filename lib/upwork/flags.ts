// Master switches for the Upwork MCP integration (handover §5, §1 guardrail 4).
// Both stay OFF until Upwork approves hosted-client use / scheduled activity.

export function mcpEnabled(): boolean {
  return process.env.UPWORK_MCP_ENABLED === "true";
}

export function syncScheduleEnabled(): boolean {
  return process.env.UPWORK_SYNC_SCHEDULE_ENABLED === "true";
}

export function mcpUrl(): string {
  return process.env.UPWORK_MCP_URL || "https://mcp.upwork.com/mcp";
}

export const DISABLED_DETAIL = "Upwork integration is disabled pending Upwork approval";

// Local-dev only: fake Upwork (lib/upwork/mock.ts) so the connect flow and UI can be
// exercised without real credentials. Ignored in production. Mock data carries provenance "MOCK".
export function mockMode(): boolean {
  return process.env.UPWORK_MCP_MOCK === "true" && process.env.NODE_ENV !== "production";
}
