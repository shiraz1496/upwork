// Raw Upwork MCP tool output → our DTOs.
// Shapes verified against the live server on 2026-09-30 (read-only calls with a test account)
// for: list_accounts, find_jobs (search + smart_search), get_messages list_rooms,
// list_contracts search. list_freelancer_proposals rows are UNVERIFIED (the test account has
// no proposals) and mapped defensively.
// Unknown stays null — the UI shows "unavailable", not zero.

import type { McpToolResult } from "@/lib/upwork/client";
import { McpProtocolError } from "@/lib/upwork/errors";

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Every Upwork tool answers a JSON object with status "ok" (plus trace_id).
export function toolPayload(result: McpToolResult): unknown {
  let payload: unknown = result.structuredContent;
  if (payload === undefined) {
    const text = (result.content ?? [])
      .filter((c) => c.type === "text" && c.text)
      .map((c) => c.text)
      .join("\n");
    if (!text) return null;
    try {
      payload = JSON.parse(text);
    } catch {
      return text;
    }
  }
  if (isObj(payload) && typeof payload.status === "string" && payload.status !== "ok") {
    throw new McpProtocolError(`Upwork tool returned status "${payload.status}"`);
  }
  return payload;
}

function at(o: unknown, ...path: string[]): unknown {
  let cur: unknown = o;
  for (const k of path) {
    if (!isObj(cur)) return undefined;
    cur = cur[k];
  }
  return cur;
}

function objs(v: unknown): Obj[] {
  return Array.isArray(v) ? v.filter(isObj) : [];
}

function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : typeof v === "number" ? String(v) : null;
}

// A blank or unparseable value is unknown (null) — never 0. Understands "$7,233.56", "$10K+".
function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const m = v.replace(/[$,\s+]/g, "").match(/^(-?\d+(?:\.\d+)?)([KMB]?)$/i);
  if (!m) return null;
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[m[2].toUpperCase()] ?? 1;
  return Number(m[1]) * mult;
}

function isoDate(v: unknown): string | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// Upwork wraps text written by other people (job descriptions, messages, room names) in
// <untrusted_participant_content> tags. Strip the tags; the content is display-only text.
export function untrusted(v: unknown): string | null {
  const s = str(v);
  if (s === null) return null;
  return s.replace(/<\/?untrusted_participant_content>/g, "").trim() || null;
}

// Job links come back with LLM tracking params (utm_*); keep the bare job URL.
function cleanUrl(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.origin + u.pathname;
  } catch {
    return null;
  }
}

// ---------- accounts (list_accounts) ----------

export type UpworkAccountDto = { orgUid: string; name: string | null; role: string | null };
export function normalizeAccounts(payload: unknown): UpworkAccountDto[] {
  return objs(at(payload, "accounts"))
    .map((a) => ({ orgUid: str(a.org_uid), name: str(a.name), role: str(a.role) }))
    .filter((a): a is UpworkAccountDto => a.orgUid !== null);
}

// ---------- jobs (find_jobs search / smart_search) ----------

// budget is text: "100.00" (fixed), "15.00–20.00/hr", "25.00+/hr", "up to 40.00/hr", or absent.
export function parseBudget(budget: unknown): { min: number | null; max: number | null } {
  const s = str(budget);
  if (!s) return { min: null, max: null };
  const nums = (s.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => Number(n.replace(/,/g, "")));
  if (nums.length === 0) return { min: null, max: null };
  if (nums.length >= 2) return { min: nums[0], max: nums[1] };
  if (/up to/i.test(s)) return { min: null, max: nums[0] };
  if (s.includes("+")) return { min: nums[0], max: null };
  return { min: nums[0], max: nums[0] };
}

export type JobDto = {
  upworkJobId: string;
  title: string;
  url: string | null;
  descriptionSnippet: string | null;
  skills: string[];
  jobType: "hourly" | "fixed" | null;
  budgetMin: number | null;
  budgetMax: number | null;
  experienceLevel: string | null;
  duration: string | null;
  proposalsTier: string | null;
  postedAt: string | null;
  applied: boolean | null;
  client: {
    country: string | null;
    rating: number | null;
    totalSpent: number | null;
    totalPostedJobs: number | null;
    totalReviews: number | null;
    // Only some feeds include it (seen on the dashboard feed, not on search).
    totalHires: number | null;
    paymentVerified: boolean | null;
  };
};
export function normalizeJobs(payload: unknown): JobDto[] {
  return objs(at(payload, "jobs"))
    .map((o): JobDto | null => {
      const id = str(o.id);
      const title = str(o.title);
      if (!id || !title) return null;
      const type = str(o.job_type)?.toLowerCase();
      const { min, max } = parseBudget(o.budget);
      const client = isObj(o.client) ? o.client : {};
      const verification = str(client.verification_status);
      return {
        upworkJobId: id,
        title,
        url: cleanUrl(o.url),
        descriptionSnippet: untrusted(o.description_snippet ?? o.description),
        skills: Array.isArray(o.skills) ? o.skills.filter((s): s is string => typeof s === "string") : [],
        jobType: type === "hourly" || type === "fixed" ? type : null,
        budgetMin: min,
        budgetMax: max,
        experienceLevel: str(o.experience_level)?.toLowerCase() ?? null,
        duration: str(o.duration),
        proposalsTier: str(o.proposals_tier),
        postedAt: isoDate(o.published_date ?? o.created_date),
        applied: typeof o.applied === "boolean" ? o.applied : null,
        client: {
          country: str(client.country),
          rating: num(client.rating),
          totalSpent: num(client.total_spent),
          totalPostedJobs: num(client.total_posted_jobs),
          totalReviews: num(client.total_reviews),
          totalHires: num(client.total_hires),
          paymentVerified: verification ? verification === "VERIFIED" : null,
        },
      };
    })
    .filter((j): j is JobDto => j !== null);
}

// ---------- message rooms (get_messages list_rooms) ----------

export type RoomDto = {
  upworkThreadId: string;
  upworkMessageId: string | null;
  kind: "message" | "interview";
  lastMessageAt: string | null;
  // true when the bidder wrote last → not a client response.
  lastMessageFromSelf: boolean | null;
  unread: number | null;
  // Short preview only (retention-bound); full bodies are never stored.
  snippet: string | null;
};
export function normalizeRooms(payload: unknown): RoomDto[] {
  return objs(at(payload, "data", "rooms"))
    .map((o): RoomDto | null => {
      const id = str(o.id);
      if (!id) return null;
      const story = isObj(o.latestStory) ? o.latestStory : {};
      const body = untrusted(story.message);
      return {
        upworkThreadId: id,
        upworkMessageId: str(story.id),
        kind: str(o.roomType) === "INTERVIEW" ? "interview" : "message",
        lastMessageAt: isoDate(story.createdDateTime),
        lastMessageFromSelf: typeof o.last_message_from_self === "boolean" ? o.last_message_from_self : null,
        unread: num(o.numUnread),
        snippet: body ? body.slice(0, 200) : null,
      };
    })
    .filter((r): r is RoomDto => r !== null);
}

// ---------- contracts (list_contracts search, freelancer side) ----------

export type ContractDto = {
  upworkContractId: string;
  title: string | null;
  status: string | null;
  clientName: string | null;
  upworkOfferId: string | null;
  startedAt: string | null;
  endedAt: string | null;
};
export function normalizeContracts(payload: unknown): ContractDto[] {
  return objs(at(payload, "data", "vendorContracts", "contracts"))
    .map((o): ContractDto | null => {
      const id = str(o.id);
      if (!id) return null;
      return {
        upworkContractId: id,
        title: str(o.title),
        status: str(o.status),
        clientName: str(at(o, "clientOrganization", "name")),
        upworkOfferId: str(o.offerId),
        startedAt: isoDate(o.startDate),
        endedAt: isoDate(o.endDate),
      };
    })
    .filter((c): c is ContractDto => c !== null);
}

// ---------- the member's own proposals (list_freelancer_proposals list / get) ----------
// Row and detail shapes verified against the live server on 2026-09-30.

export type ProposalDto = {
  upworkProposalId: string;
  // Upwork's status word: Accepted (= submitted), Offered, Hired, Activated, Pending,
  // Declined, Withdrawn, Archived.
  status: string | null;
  statusLabel: string | null;
  upworkJobId: string | null;
  jobTitle: string | null;
  createdAt: string | null;
  modifiedAt: string | null;
};

// Dates arrive as { displayValue: ISO string, rawValue: epoch-ms string }.
function auditDate(v: unknown): string | null {
  return isoDate(at(v, "displayValue")) ?? (num(at(v, "rawValue")) !== null ? isoDate(num(at(v, "rawValue"))) : null);
}

function proposalNode(o: Obj): ProposalDto | null {
  const id = str(o.id);
  if (!id) return null;
  const job = isObj(o.marketplaceJobPosting) ? o.marketplaceJobPosting : {};
  return {
    upworkProposalId: id,
    status: str(at(o, "status", "status")),
    statusLabel: str(at(o, "status", "status_label")),
    upworkJobId: str(job.id),
    jobTitle: untrusted(at(job, "content", "title")),
    createdAt: auditDate(at(o, "auditDetails", "createdDateTime")),
    modifiedAt: auditDate(at(o, "auditDetails", "modifiedDateTime")),
  };
}

export function normalizeProposals(payload: unknown): ProposalDto[] {
  return objs(at(payload, "data", "vendorProposals", "edges"))
    .map((e) => (isObj(e.node) ? proposalNode(e.node) : null))
    .filter((p): p is ProposalDto => p !== null);
}

// action=get: the proposal plus the message room Upwork has for it (top-level room_id).
// That room id is the verified link between a proposal and a client conversation.
export function normalizeProposalDetail(payload: unknown): { proposal: ProposalDto | null; roomId: string | null } {
  const node = at(payload, "data", "vendorProposal");
  return { proposal: isObj(node) ? proposalNode(node) : null, roomId: str(at(payload, "room_id")) };
}

// ---------- own profile + connects (get_profile get / connects_balance) ----------
// Shapes verified against the live server on 2026-09-30.

export type ProfileDto = {
  title: string | null;
  overview: string | null;
  location: string | null;
  hourlyRate: string | null;
  totalEarnings: string | null;
  totalJobs: number | null;
  skills: string[];
};
export function normalizeProfile(payload: unknown): ProfileDto {
  const personal = at(payload, "data", "personalData");
  const agg = at(payload, "data", "profileAggregates");
  const place = [str(at(personal, "location", "state")), str(at(personal, "location", "country"))].filter(Boolean).join(", ");
  return {
    title: untrusted(at(personal, "title")),
    overview: untrusted(at(personal, "description")),
    location: place || null,
    hourlyRate: str(at(personal, "chargeRate", "displayValue")),
    totalEarnings: str(at(agg, "totalEarnings")),
    totalJobs: num(at(agg, "totalJobs")),
    skills: objs(at(payload, "data", "skills"))
      .map((sk) => str(sk.prettyName))
      .filter((x): x is string => x !== null),
  };
}

export function normalizeConnectsBalance(payload: unknown): number | null {
  return num(at(payload, "balance", "connectsBalance"));
}
