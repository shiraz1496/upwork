// Extension ingestion was removed in the MCP migration (DEVELOPER_HANDOVER.md Phase C).
// Former extension endpoints answer 410 Gone and do nothing else.
export function extensionGone(): Response {
  return Response.json(
    { error: "deprecated", detail: "extension ingestion removed; see MCP migration" },
    { status: 410 },
  );
}
