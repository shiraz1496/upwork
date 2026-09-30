// Deterministic job review (handover Phase F). Pure functions, no I/O.
//
// Applies only what an admin configured: BiddingCriterion rows, BlockedTitle patterns and
// per-account keywords. It returns the REASONS (which criteria matched / failed / could not
// be checked). It does not score, rank or reorder jobs, and it never decides a bid.
//
// checkCriterion mirrors the rule set the extension used (extension/src/content.js) so
// admins' existing criteria keep meaning the same thing. One deliberate difference:
// a client country we cannot recognise is "unknown", not "pass" (see canonicalCountry).

import { COUNTRY_LIST } from "@/lib/countries";

export type CriterionStatus = "pass" | "fail" | "unknown";

export type Criterion = {
  key: string;
  operator: string; // gte | lte | eq | neq
  value: string;
  required: boolean;
};

// What we know about a job. null = not available → criterion is "unknown", never assumed.
export type JobFacts = {
  clientTotalSpent: number | null;
  clientRating: number | null;
  clientHireRate: number | null;
  clientReviews: number | null;
  clientJobsPosted: number | null;
  clientHires: number | null;
  clientActiveHires: number | null;
  clientPaymentVerified: boolean | null;
  clientCountry: string | null;
  jobInterviewing: number | null;
  jobProposals: number | null;
  jobHires: number | null;
  jobLastViewedHours: number | null;
  skillMatchCount: number | null;
};

export const EMPTY_FACTS: JobFacts = {
  clientTotalSpent: null,
  clientRating: null,
  clientHireRate: null,
  clientReviews: null,
  clientJobsPosted: null,
  clientHires: null,
  clientActiveHires: null,
  clientPaymentVerified: null,
  clientCountry: null,
  jobInterviewing: null,
  jobProposals: null,
  jobHires: null,
  jobLastViewedHours: null,
  skillMatchCount: null,
};

const FIELD: Record<string, { label: string; fact: keyof JobFacts }> = {
  client_total_spent: { label: "Client Total Spent", fact: "clientTotalSpent" },
  client_rating: { label: "Client Rating", fact: "clientRating" },
  client_hire_rate: { label: "Client Hire Rate", fact: "clientHireRate" },
  client_reviews: { label: "Client Reviews", fact: "clientReviews" },
  client_jobs_posted: { label: "Client Jobs Posted", fact: "clientJobsPosted" },
  client_hires: { label: "Client Hires", fact: "clientHires" },
  client_active_hires: { label: "Client Active Hires", fact: "clientActiveHires" },
  client_payment_verified: { label: "Payment Verified", fact: "clientPaymentVerified" },
  client_country: { label: "Client Country", fact: "clientCountry" },
  job_interviewing: { label: "Interviewing", fact: "jobInterviewing" },
  job_proposals: { label: "Proposals", fact: "jobProposals" },
  job_hires: { label: "Hires (this job)", fact: "jobHires" },
  job_last_viewed: { label: "Last Viewed (hours ago)", fact: "jobLastViewedHours" },
  job_skill_match: { label: "Skill Match", fact: "skillMatchCount" },
};

// ---------- countries ----------
// Upwork returns a country as a full name ("United States"), a short name ("USA") or an
// ISO-3 code ("GBR", "ITA"). Map all of them onto the names admins pick from COUNTRY_LIST.

const ISO3: Record<string, string> = {
  AFG: "Afghanistan", ALB: "Albania", DZA: "Algeria", AND: "Andorra", AGO: "Angola", ATG: "Antigua and Barbuda",
  ARG: "Argentina", ARM: "Armenia", AUS: "Australia", AUT: "Austria", AZE: "Azerbaijan", BHS: "Bahamas",
  BHR: "Bahrain", BGD: "Bangladesh", BRB: "Barbados", BLR: "Belarus", BEL: "Belgium", BLZ: "Belize",
  BEN: "Benin", BTN: "Bhutan", BOL: "Bolivia", BIH: "Bosnia and Herzegovina", BWA: "Botswana", BRA: "Brazil",
  BRN: "Brunei", BGR: "Bulgaria", BFA: "Burkina Faso", BDI: "Burundi", CIV: "Côte d'Ivoire", CPV: "Cabo Verde",
  KHM: "Cambodia", CMR: "Cameroon", CAN: "Canada", CAF: "Central African Republic", TCD: "Chad", CHL: "Chile",
  CHN: "China", COL: "Colombia", COM: "Comoros", COG: "Congo", CRI: "Costa Rica", HRV: "Croatia", CUB: "Cuba",
  CYP: "Cyprus", CZE: "Czech Republic", COD: "Democratic Republic of the Congo", DNK: "Denmark", DJI: "Djibouti",
  DMA: "Dominica", DOM: "Dominican Republic", ECU: "Ecuador", EGY: "Egypt", SLV: "El Salvador",
  GNQ: "Equatorial Guinea", ERI: "Eritrea", EST: "Estonia", SWZ: "Eswatini", ETH: "Ethiopia", FJI: "Fiji",
  FIN: "Finland", FRA: "France", GAB: "Gabon", GMB: "Gambia", GEO: "Georgia", DEU: "Germany", GHA: "Ghana",
  GRC: "Greece", GRD: "Grenada", GTM: "Guatemala", GIN: "Guinea", GNB: "Guinea-Bissau", GUY: "Guyana",
  HTI: "Haiti", HND: "Honduras", HUN: "Hungary", ISL: "Iceland", IND: "India", IDN: "Indonesia", IRN: "Iran",
  IRQ: "Iraq", IRL: "Ireland", ISR: "Israel", ITA: "Italy", JAM: "Jamaica", JPN: "Japan", JOR: "Jordan",
  KAZ: "Kazakhstan", KEN: "Kenya", KIR: "Kiribati", KWT: "Kuwait", KGZ: "Kyrgyzstan", LAO: "Laos", LVA: "Latvia",
  LBN: "Lebanon", LSO: "Lesotho", LBR: "Liberia", LBY: "Libya", LIE: "Liechtenstein", LTU: "Lithuania",
  LUX: "Luxembourg", MDG: "Madagascar", MWI: "Malawi", MYS: "Malaysia", MDV: "Maldives", MLI: "Mali",
  MLT: "Malta", MHL: "Marshall Islands", MRT: "Mauritania", MUS: "Mauritius", MEX: "Mexico", FSM: "Micronesia",
  MDA: "Moldova", MCO: "Monaco", MNG: "Mongolia", MNE: "Montenegro", MAR: "Morocco", MOZ: "Mozambique",
  MMR: "Myanmar", NAM: "Namibia", NRU: "Nauru", NPL: "Nepal", NLD: "Netherlands", NZL: "New Zealand",
  NIC: "Nicaragua", NER: "Niger", NGA: "Nigeria", PRK: "North Korea", MKD: "North Macedonia", NOR: "Norway",
  OMN: "Oman", PAK: "Pakistan", PLW: "Palau", PSE: "Palestine", PAN: "Panama", PNG: "Papua New Guinea",
  PRY: "Paraguay", PER: "Peru", PHL: "Philippines", POL: "Poland", PRT: "Portugal", QAT: "Qatar", ROU: "Romania",
  RUS: "Russia", RWA: "Rwanda", KNA: "Saint Kitts and Nevis", LCA: "Saint Lucia",
  VCT: "Saint Vincent and the Grenadines", WSM: "Samoa", SMR: "San Marino", STP: "Sao Tome and Principe",
  SAU: "Saudi Arabia", SEN: "Senegal", SRB: "Serbia", SYC: "Seychelles", SLE: "Sierra Leone", SGP: "Singapore",
  SVK: "Slovakia", SVN: "Slovenia", SLB: "Solomon Islands", SOM: "Somalia", ZAF: "South Africa", KOR: "South Korea",
  SSD: "South Sudan", ESP: "Spain", LKA: "Sri Lanka", SDN: "Sudan", SUR: "Suriname", SWE: "Sweden",
  CHE: "Switzerland", SYR: "Syria", TWN: "Taiwan", TJK: "Tajikistan", TZA: "Tanzania", THA: "Thailand",
  TLS: "Timor-Leste", TGO: "Togo", TON: "Tonga", TTO: "Trinidad and Tobago", TUN: "Tunisia", TUR: "Turkey",
  TKM: "Turkmenistan", TUV: "Tuvalu", ARE: "UAE", GBR: "UK", UGA: "Uganda", UKR: "Ukraine", USA: "United States",
  URY: "Uruguay", UZB: "Uzbekistan", VUT: "Vanuatu", VAT: "Vatican City", VEN: "Venezuela", VNM: "Vietnam",
  YEM: "Yemen", ZMB: "Zambia", ZWE: "Zimbabwe",
};

const ALIASES: Record<string, string> = {
  us: "United States",
  "u.s.": "United States",
  "u.s.a.": "United States",
  "united states of america": "United States",
  "united kingdom": "UK",
  "great britain": "UK",
  "united arab emirates": "UAE",
  "russian federation": "Russia",
  "korea, republic of": "South Korea",
  "republic of korea": "South Korea",
  "viet nam": "Vietnam",
  turkiye: "Turkey",
  "türkiye": "Turkey",
  czechia: "Czech Republic",
  "cote d'ivoire": "Côte d'Ivoire",
  "ivory coast": "Côte d'Ivoire",
  "cape verde": "Cabo Verde",
  swaziland: "Eswatini",
  burma: "Myanmar",
  macedonia: "North Macedonia",
};

const BY_NAME = new Map(COUNTRY_LIST.map((n) => [n.toLowerCase(), n]));

// Canonical country name, or null when the value cannot be recognised.
export function canonicalCountry(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;
  const lower = s.toLowerCase();
  return BY_NAME.get(lower) ?? ALIASES[lower] ?? ISO3[s.toUpperCase()] ?? null;
}

// ---------- single criterion ----------

export function checkCriterion(c: Criterion, facts: JobFacts): CriterionStatus {
  const field = FIELD[c.key];
  if (!field) return "unknown";
  const actual = facts[field.fact];
  if (actual === null || actual === undefined) return "unknown";

  if (c.key === "client_payment_verified") return actual === true ? "pass" : "fail";

  if (c.key === "client_country") {
    // The criterion value is a comma-separated country list (a block list with "neq").
    // If either side can't be recognised we say "unknown" rather than let it pass.
    const job = canonicalCountry(String(actual));
    if (!job) return "unknown";
    const listed = c.value.split(",").map((s) => s.trim()).filter(Boolean);
    if (listed.length === 0) return "unknown";
    const canon = listed.map(canonicalCountry);
    const matches = canon.includes(job);
    // A match is definite. Without one, an unrecognised entry in the list means we cannot
    // be sure the job's country is not that entry.
    if (!matches && canon.some((x) => x === null)) return "unknown";
    return c.operator === "neq" ? (matches ? "fail" : "pass") : matches ? "pass" : "fail";
  }

  if (typeof actual !== "number") return "unknown";
  const threshold = parseFloat(c.value);
  if (Number.isNaN(threshold)) return "unknown";
  const pass =
    c.operator === "gte"
      ? actual >= threshold
      : c.operator === "lte"
        ? actual <= threshold
        : c.operator === "neq"
          ? actual !== threshold
          : actual === threshold;
  return pass ? "pass" : "fail";
}

export function criterionLabel(c: Criterion): string {
  const label = FIELD[c.key]?.label ?? c.key;
  if (c.key === "client_payment_verified") return label;
  if (c.key === "client_country") {
    const countries = c.value.split(",").map((s) => s.trim()).filter(Boolean).join(", ");
    return `${label} ${c.operator === "neq" ? "≠" : "="} ${countries}`;
  }
  const op = c.operator === "gte" ? "≥" : c.operator === "lte" ? "≤" : c.operator === "neq" ? "≠" : "=";
  const n = Number(c.value);
  const val =
    c.key === "client_total_spent" && Number.isFinite(n)
      ? `$${n.toLocaleString("en-US")}`
      : c.key === "client_hire_rate"
        ? `${c.value}%`
        : c.key === "client_rating"
          ? `${c.value}/5`
          : c.value;
  return `${label} ${op} ${val}`;
}

// ---------- helpers for facts ----------

// Upwork shows proposals as a range. Same mapping the extension used (the upper bound):
// "Fewer than 5" → 4, "5 to 10" → 10, "50+" → 100, "7" → 7.
export function parseProposalRange(str: string | null | undefined): number | null {
  if (!str) return null;
  const lt = str.match(/(?:less|fewer)\s*than\s*(\d+)/i);
  if (lt) return parseInt(lt[1], 10) - 1;
  const range = str.match(/(\d+)\s*to\s*(\d+)/i);
  if (range) return parseInt(range[2], 10);
  const plus = str.match(/(\d+)\+/);
  if (plus) return parseInt(plus[1], 10) + 50;
  const exact = str.trim().match(/^(\d+)$/);
  if (exact) return parseInt(exact[1], 10);
  return null;
}

export function skillMatchCount(jobSkills: string[], freelancerSkills: string[] | null | undefined): number | null {
  if (!freelancerSkills || freelancerSkills.length === 0) return null;
  const mine = new Set(freelancerSkills.map((s) => s.toLowerCase().trim()));
  return jobSkills.filter((s) => mine.has(s.toLowerCase().trim())).length;
}

// Same rule as lib/blocked-titles.ts: a single-word pattern must equal the whole title,
// a multi-word pattern may appear anywhere in it.
export function matchesBlockedPattern(title: string, pattern: string): boolean {
  const lower = title.toLowerCase().trim();
  const p = pattern.toLowerCase().trim();
  if (!p) return false;
  if (lower === p) return true;
  return p.split(" ").length >= 2 && lower.includes(p);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Whole-word, case-insensitive ("AI" must not match "email"; "C" must not match "C++" or "C#").
export function matchedKeywords(text: string, keywords: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of keywords) {
    const k = raw.trim();
    if (!k || seen.has(k.toLowerCase())) continue;
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(k)}(?![\\p{L}\\p{N}+#])`, "iu");
    if (re.test(text)) {
      seen.add(k.toLowerCase());
      out.push(k);
    }
  }
  return out;
}

// ---------- whole job ----------

export type JobForReview = {
  title: string;
  descriptionSnippet: string | null;
  skills: string[];
  facts: JobFacts;
};

export type ReviewConfig = {
  criteria: Criterion[];
  blockedTitlePatterns: string[];
  keywords: string[];
};

export type JobEvaluation = {
  results: { key: string; label: string; required: boolean; status: CriterionStatus }[];
  // Plain-language reasons, e.g. ["Client Rating ≥ 4.5/5", "keyword: Laravel"].
  matched: string[];
  failed: string[];
  unknown: string[];
  blockedBy: string | null;
  // true  = every required criterion passed and the title is not blocked
  // false = a required criterion failed or the title is blocked
  // null  = nothing failed, but a required criterion could not be checked (or none are configured)
  meetsRequired: boolean | null;
};

export function evaluateJob(job: JobForReview, config: ReviewConfig): JobEvaluation {
  const results = config.criteria.map((c) => ({
    key: c.key,
    label: criterionLabel(c),
    required: c.required,
    status: checkCriterion(c, job.facts),
  }));

  const blockedBy = config.blockedTitlePatterns.find((p) => matchesBlockedPattern(job.title, p)) ?? null;
  const text = [job.title, job.descriptionSnippet ?? "", job.skills.join(" , ")].join("\n");
  const keywords = matchedKeywords(text, config.keywords);

  const matched = [...results.filter((r) => r.status === "pass").map((r) => r.label), ...keywords.map((k) => `keyword: ${k}`)];
  const failed = results.filter((r) => r.status === "fail").map((r) => r.label);
  if (blockedBy) failed.push(`blocked title: ${blockedBy}`);
  const unknown = results.filter((r) => r.status === "unknown").map((r) => r.label);

  const required = results.filter((r) => r.required);
  let meetsRequired: boolean | null;
  if (blockedBy || required.some((r) => r.status === "fail")) meetsRequired = false;
  else if (required.length === 0 || required.some((r) => r.status === "unknown")) meetsRequired = null;
  else meetsRequired = true;

  return { results, matched, failed, unknown, blockedBy, meetsRequired };
}
