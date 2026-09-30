// Same job, however the id was written: "2105…", "~022105…", "~012105…".
export function jobIdKey(id: string): string {
  return id.trim().replace(/^~0\d(?=\d+$)/, "");
}

// The job id inside an Upwork job link, in its normal form — or null if the link has none.
//   …/jobs/~022105140434795735776        → "2105140434795735776"   (current links)
//   …/jobs/Some-title_~01a1b2c3d4e5f6a7b8 → "~01a1b2c3d4e5f6a7b8"    (older links)
// The server derives the id from the link itself, so the two can never disagree.
export function jobIdFromUrl(url: string): string | null {
  const current = url.match(/~02(\d{10,})(?![0-9a-f])/i);
  if (current) return current[1];
  const older = url.match(/~01[0-9a-f]{10,}/i);
  return older ? jobIdKey(older[0].toLowerCase()) : null;
}

// Test mode uses a made-up Upwork account id. It is deliberately not numeric, so it can
// never be mistaken for (or collide with) a real org_uid.
export const MOCK_ORG_UID = "mock-org-1";
export function isMockOrgUid(id: string): boolean {
  return id.startsWith("mock-");
}
