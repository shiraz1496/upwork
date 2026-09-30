// Retention for MCP-derived data we cache (handover Phase H). Developer-authored content
// (cover letters, bids, notes) is NOT covered by this — it is the team's own data.
// The number of days is a placeholder policy until Upwork confirms its retention terms
// (handover §11 Q5); change it here only.
export const MCP_DATA_TTL_DAYS = 30;

export function mcpDataExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + MCP_DATA_TTL_DAYS * 24 * 60 * 60 * 1000);
}
