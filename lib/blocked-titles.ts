import { prisma } from "@/lib/prisma";

export type BlockedTitleScope = "proposals" | "contracts";

type CacheEntry = { patterns: string[]; loadedAt: number };

const CACHE_TTL_MS = 60_000;
const cache = new Map<BlockedTitleScope, CacheEntry>();

async function loadPatterns(scope: BlockedTitleScope): Promise<string[]> {
  const rows = await prisma.blockedTitle.findMany({
    where: {
      active: true,
      OR: [{ scope: "all" }, { scope }],
    },
    select: { pattern: true },
  });
  return rows.map((r) => r.pattern.toLowerCase().trim()).filter(Boolean);
}

export async function getBlockedTitlePatterns(scope: BlockedTitleScope): Promise<string[]> {
  const now = Date.now();
  const hit = cache.get(scope);
  if (hit && now - hit.loadedAt < CACHE_TTL_MS) return hit.patterns;
  const patterns = await loadPatterns(scope);
  cache.set(scope, { patterns, loadedAt: now });
  return patterns;
}

export function invalidateBlockedTitleCache() {
  cache.clear();
}

// Mirrors the matching rule the proposals sync route used: short patterns
// must match exactly, multi-word phrases may match as substrings. This
// avoids "open job" filtering out e.g. "open job for senior dev".
function matchesPattern(lower: string, pattern: string): boolean {
  if (lower === pattern) return true;
  if (pattern.split(" ").length >= 3 && lower.includes(pattern)) return true;
  return false;
}

// Structural regexes that aren't user-managed — they describe page chrome
// shapes (notification text, pagination, etc.) rather than literal titles,
// so they stay in code.
const STRUCTURAL_BAD_PATTERNS: RegExp[] = [
  /^your proposal for .+ was viewed\.?$/,
  /^new job:/,
  /^your proposal may still appear/,
  /^current page \d/,
];

export async function isBadTitle(title: string, scope: BlockedTitleScope): Promise<boolean> {
  const lower = title.toLowerCase().trim();
  if (lower.length < 5) return true;
  for (const re of STRUCTURAL_BAD_PATTERNS) {
    if (re.test(lower)) return true;
  }
  const patterns = await getBlockedTitlePatterns(scope);
  for (const p of patterns) {
    if (matchesPattern(lower, p)) return true;
  }
  return false;
}
