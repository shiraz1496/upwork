import { describe, expect, it } from "vitest";
import { COUNTRY_LIST } from "@/lib/countries";
import {
  canonicalCountry,
  checkCriterion,
  criterionLabel,
  EMPTY_FACTS,
  evaluateJob,
  matchedKeywords,
  matchesBlockedPattern,
  parseProposalRange,
  skillMatchCount,
  type Criterion,
  type JobFacts,
} from "@/lib/criteria";

const facts = (over: Partial<JobFacts> = {}): JobFacts => ({ ...EMPTY_FACTS, ...over });
const crit = (key: string, operator: string, value: string, required = true): Criterion => ({ key, operator, value, required });

describe("canonicalCountry", () => {
  it("maps every form Upwork was seen returning onto the admin list names", () => {
    expect(canonicalCountry("United States")).toBe("United States");
    expect(canonicalCountry("USA")).toBe("United States");
    expect(canonicalCountry("GBR")).toBe("UK");
    expect(canonicalCountry("United Kingdom")).toBe("UK");
    expect(canonicalCountry("ITA")).toBe("Italy");
    expect(canonicalCountry("pakistan")).toBe("Pakistan");
    expect(canonicalCountry("  India ")).toBe("India");
  });
  it("returns null for something it cannot recognise", () => {
    expect(canonicalCountry("Atlantis")).toBeNull();
    expect(canonicalCountry("")).toBeNull();
    expect(canonicalCountry(null)).toBeNull();
  });
  it("has exactly one ISO-3 code for every country an admin can pick", () => {
    // Re-derive the table through the public function: every list name must be reachable
    // from some 3-letter code, and no code may point at a name that is not in the list.
    const codes: string[] = [];
    for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) for (let c = 65; c <= 90; c++) codes.push(String.fromCharCode(a, b, c));
    const byName = new Map<string, string[]>();
    for (const code of codes) {
      const name = canonicalCountry(code);
      if (!name) continue;
      expect(COUNTRY_LIST).toContain(name);
      // "UAE" is both a list name and not an ISO code; skip names matched by name rather than code.
      if (COUNTRY_LIST.some((n) => n.toUpperCase() === code)) continue;
      byName.set(name, [...(byName.get(name) ?? []), code]);
    }
    const missing = COUNTRY_LIST.filter((n) => !byName.has(n));
    const duplicated = [...byName].filter(([, c]) => c.length > 1);
    expect(missing).toEqual([]);
    expect(duplicated).toEqual([]);
  });
});

describe("checkCriterion — numbers", () => {
  it.each([
    ["gte", "1000", 1000, "pass"],
    ["gte", "1000", 999.99, "fail"],
    ["lte", "10", 10, "pass"],
    ["lte", "10", 11, "fail"],
    ["eq", "5", 5, "pass"],
    ["eq", "5", 4, "fail"],
    ["neq", "5", 4, "pass"],
    ["neq", "5", 5, "fail"],
  ])("%s %s with %s → %s", (operator, value, actual, expected) => {
    expect(checkCriterion(crit("client_total_spent", operator, value), facts({ clientTotalSpent: actual }))).toBe(expected);
  });
  it("missing data is unknown, never treated as zero", () => {
    expect(checkCriterion(crit("client_total_spent", "gte", "1000"), facts())).toBe("unknown");
    expect(checkCriterion(crit("client_hire_rate", "gte", "50"), facts())).toBe("unknown");
  });
  it("a real zero is a value, not unknown", () => {
    expect(checkCriterion(crit("client_hires", "gte", "1"), facts({ clientHires: 0 }))).toBe("fail");
    expect(checkCriterion(crit("job_proposals", "lte", "10"), facts({ jobProposals: 0 }))).toBe("pass");
  });
  it("unknown key or non-numeric threshold is unknown", () => {
    expect(checkCriterion(crit("made_up", "gte", "1"), facts())).toBe("unknown");
    expect(checkCriterion(crit("client_rating", "gte", "abc"), facts({ clientRating: 5 }))).toBe("unknown");
  });
});

describe("checkCriterion — payment verified", () => {
  it("true passes, false fails, null unknown", () => {
    const c = crit("client_payment_verified", "eq", "true");
    expect(checkCriterion(c, facts({ clientPaymentVerified: true }))).toBe("pass");
    expect(checkCriterion(c, facts({ clientPaymentVerified: false }))).toBe("fail");
    expect(checkCriterion(c, facts())).toBe("unknown");
  });
});

describe("checkCriterion — blocked countries (neq)", () => {
  const c = crit("client_country", "neq", "India, Pakistan");
  it("fails a blocked country in any spelling Upwork uses", () => {
    expect(checkCriterion(c, facts({ clientCountry: "India" }))).toBe("fail");
    expect(checkCriterion(c, facts({ clientCountry: "IND" }))).toBe("fail");
    expect(checkCriterion(c, facts({ clientCountry: "pakistan" }))).toBe("fail");
    expect(checkCriterion(c, facts({ clientCountry: "PAK" }))).toBe("fail");
  });
  it("passes a recognised country that is not blocked", () => {
    expect(checkCriterion(c, facts({ clientCountry: "United States" }))).toBe("pass");
    expect(checkCriterion(c, facts({ clientCountry: "USA" }))).toBe("pass");
  });
  it("an unrecognised country is unknown — it must not slip through as pass", () => {
    expect(checkCriterion(c, facts({ clientCountry: "XYZ" }))).toBe("unknown");
    expect(checkCriterion(c, facts({ clientCountry: "Some New Place" }))).toBe("unknown");
    expect(checkCriterion(c, facts())).toBe("unknown");
  });
  it("a definite match still fails when another listed country is unrecognised", () => {
    const mixed = crit("client_country", "neq", "India, Some Made-Up Place");
    expect(checkCriterion(mixed, facts({ clientCountry: "IND" }))).toBe("fail");
    // …but with no match, the unrecognised entry means we cannot say "pass".
    expect(checkCriterion(mixed, facts({ clientCountry: "USA" }))).toBe("unknown");
  });

  it("blocking the UK catches GBR and 'United Kingdom'", () => {
    const uk = crit("client_country", "neq", "UK");
    expect(checkCriterion(uk, facts({ clientCountry: "GBR" }))).toBe("fail");
    expect(checkCriterion(uk, facts({ clientCountry: "United Kingdom" }))).toBe("fail");
  });
  it("eq operator means 'must be one of'", () => {
    const only = crit("client_country", "eq", "United States, Canada");
    expect(checkCriterion(only, facts({ clientCountry: "CAN" }))).toBe("pass");
    expect(checkCriterion(only, facts({ clientCountry: "India" }))).toBe("fail");
  });
});

describe("labels", () => {
  it("reads like the admin screen", () => {
    expect(criterionLabel(crit("client_total_spent", "gte", "1000"))).toBe("Client Total Spent ≥ $1,000");
    expect(criterionLabel(crit("client_rating", "gte", "4.5"))).toBe("Client Rating ≥ 4.5/5");
    expect(criterionLabel(crit("client_hire_rate", "gte", "50"))).toBe("Client Hire Rate ≥ 50%");
    expect(criterionLabel(crit("job_proposals", "lte", "20"))).toBe("Proposals ≤ 20");
    expect(criterionLabel(crit("client_payment_verified", "eq", "true"))).toBe("Payment Verified");
    expect(criterionLabel(crit("client_country", "neq", "India,Pakistan"))).toBe("Client Country ≠ India, Pakistan");
  });
});

describe("helpers", () => {
  it.each([
    ["Fewer than 5", 4],
    ["Less than 5", 4],
    ["5 to 10", 10],
    ["20 to 50", 50],
    ["50+", 100],
    ["7", 7],
    ["lots", null],
    [null, null],
  ])("parseProposalRange(%s) → %s", (input, expected) => {
    expect(parseProposalRange(input)).toBe(expected);
  });

  it("skillMatchCount is case-insensitive and unknown without a profile", () => {
    expect(skillMatchCount(["Laravel", "PHP", "Vue.js"], ["php", "LARAVEL", "React"])).toBe(2);
    expect(skillMatchCount(["Laravel"], [])).toBeNull();
    expect(skillMatchCount(["Laravel"], null)).toBeNull();
  });

  it("blocked patterns: one word must equal the title, a phrase may appear inside it", () => {
    expect(matchesBlockedPattern("Help", "help")).toBe(true);
    expect(matchesBlockedPattern("Help me build an app", "help")).toBe(false);
    expect(matchesBlockedPattern("Need data entry clerk", "data entry")).toBe(true);
    expect(matchesBlockedPattern("Laravel developer", "data entry")).toBe(false);
    expect(matchesBlockedPattern("anything", "  ")).toBe(false);
  });

  it("keywords match whole words only, case-insensitive, no duplicates", () => {
    expect(matchedKeywords("Need an AI agent for email", ["AI", "ai", "mail", "Agent"])).toEqual(["AI", "Agent"]);
    expect(matchedKeywords("Node.js and C++ work", ["Node.js", "C++", "C"])).toEqual(["Node.js", "C++"]);
    expect(matchedKeywords("We use C# and C, plus Laravel.", ["C", "C#", "Laravel"])).toEqual(["C", "C#", "Laravel"]);
    expect(matchedKeywords("Only C# here", ["C"])).toEqual([]);
    expect(matchedKeywords("REST API needed", ["rest api"])).toEqual(["rest api"]);
    expect(matchedKeywords("nothing here", ["Laravel", ""])).toEqual([]);
  });
});

describe("evaluateJob", () => {
  const job = {
    title: "Laravel REST API for booking app",
    descriptionSnippet: "We need an expert in Laravel and MySQL.",
    skills: ["Laravel", "REST API"],
    facts: facts({ clientTotalSpent: 5000, clientRating: 4.9, clientPaymentVerified: true, clientCountry: "USA", jobProposals: 10 }),
  };
  const config = {
    criteria: [
      crit("client_total_spent", "gte", "1000"),
      crit("client_rating", "gte", "4.5"),
      crit("client_payment_verified", "eq", "true"),
      crit("client_country", "neq", "India"),
      crit("job_proposals", "lte", "20", false),
    ],
    blockedTitlePatterns: ["data entry"],
    keywords: ["Laravel", "Shopify"],
  };

  it("lists the reasons and says it meets the required criteria", () => {
    const e = evaluateJob(job, config);
    expect(e.meetsRequired).toBe(true);
    expect(e.matched).toEqual([
      "Client Total Spent ≥ $1,000",
      "Client Rating ≥ 4.5/5",
      "Payment Verified",
      "Client Country ≠ India",
      "Proposals ≤ 20",
      "keyword: Laravel",
    ]);
    expect(e.failed).toEqual([]);
    expect(e.unknown).toEqual([]);
    expect(e.blockedBy).toBeNull();
  });

  it("has no score or rank in its output", () => {
    expect(Object.keys(evaluateJob(job, config)).sort()).toEqual(["blockedBy", "failed", "matched", "meetsRequired", "results", "unknown"]);
  });

  it("a failed required criterion → false, with the reason", () => {
    const e = evaluateJob({ ...job, facts: { ...job.facts, clientRating: 3 } }, config);
    expect(e.meetsRequired).toBe(false);
    expect(e.failed).toEqual(["Client Rating ≥ 4.5/5"]);
  });

  it("a failed OPTIONAL criterion does not make it false", () => {
    const e = evaluateJob({ ...job, facts: { ...job.facts, jobProposals: 100 } }, config);
    expect(e.meetsRequired).toBe(true);
    expect(e.failed).toEqual(["Proposals ≤ 20"]);
  });

  it("a required criterion with no data → null (limited data), not true", () => {
    const e = evaluateJob({ ...job, facts: { ...job.facts, clientTotalSpent: null } }, config);
    expect(e.meetsRequired).toBeNull();
    expect(e.unknown).toEqual(["Client Total Spent ≥ $1,000"]);
  });

  it("a fail beats an unknown", () => {
    const e = evaluateJob({ ...job, facts: { ...job.facts, clientTotalSpent: null, clientRating: 1 } }, config);
    expect(e.meetsRequired).toBe(false);
  });

  it("a blocked title → false even when every criterion passes", () => {
    const e = evaluateJob({ ...job, title: "Simple data entry task" }, config);
    expect(e.meetsRequired).toBe(false);
    expect(e.blockedBy).toBe("data entry");
    expect(e.failed).toContain("blocked title: data entry");
  });

  it("with no criteria configured it does not claim anything", () => {
    const e = evaluateJob(job, { criteria: [], blockedTitlePatterns: [], keywords: [] });
    expect(e).toEqual({ results: [], matched: [], failed: [], unknown: [], blockedBy: null, meetsRequired: null });
  });

  it("is deterministic: same input, same output", () => {
    expect(evaluateJob(job, config)).toEqual(evaluateJob(job, config));
  });
});
