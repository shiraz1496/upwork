// AI scoring is out of the required flow (handover Phase F): it may need Upwork approval,
// and bids are never auto-decided. The code is kept but off unless explicitly enabled.
export function aiScoringEnabled(): boolean {
  return process.env.AI_SCORING_ENABLED === "true";
}

export function aiScoringDisabledResponse(): Response {
  return Response.json(
    { error: "disabled", detail: "AI scoring is disabled pending Upwork approval" },
    { status: 403 },
  );
}
