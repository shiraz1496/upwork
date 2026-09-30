// Deterministic fixtures: an in-memory MCP server (Transport) and OAuth endpoints (fetch).
// Used by tests, and by local dev when UPWORK_MCP_MOCK=true (never in production).
// Services label mock data with provenance "MOCK" — it is never MCP_VERIFIED.

import type { Transport, TransportResponse } from "@/lib/upwork/client";
import { MOCK_ORG_UID } from "@/lib/upwork/ids";
import type { AuthServerMetadata } from "@/lib/upwork/oauth";

export const MOCK_META: AuthServerMetadata = {
  issuer: "https://mock.upwork.local",
  authorization_endpoint: "https://mock.upwork.local/authorize",
  token_endpoint: "https://mock.upwork.local/token",
  revocation_endpoint: "https://mock.upwork.local/revoke",
  code_challenge_methods_supported: ["S256"],
};

// Tool names as the live server lists them (2026-09-30). Read tools only.
export const MOCK_TOOLS = [
  "upwork__list_accounts",
  "upwork__get_account",
  "upwork__find_jobs",
  "upwork__get_messages",
  "upwork__list_contracts",
  "upwork__list_freelancer_proposals",
  "upwork__get_profile",
];

export { MOCK_ORG_UID };

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

// Same shapes the live server returns (verified 2026-09-30); the data itself is made up.
export const MOCK_DATA: Record<string, unknown> = {
  list_accounts: {
    accounts: [
      { name: "Mock Freelancer", org_uid: MOCK_ORG_UID, role: "TALENT", role_label: "Freelancer" },
      { name: "Mock Agency", org_uid: "2000000000000000002", role: "FL_AGENCY", role_label: "Agency" },
    ],
    trace_id: "mock",
  },
  find_jobs: {
    status: "ok",
    hasMore: false,
    jobs: [
      {
        id: "2100000000000000001",
        title: "Laravel REST API for booking app",
        url: "https://www.upwork.com/jobs/~022100000000000000001?utm_campaign=LLM_claude_MCP_jobpost&utm_source=claude",
        description_snippet: "<untrusted_participant_content>\nNeed an experienced Laravel developer to build a REST API.\n</untrusted_participant_content>",
        skills: ["Laravel", "REST API", "MySQL"],
        job_type: "hourly",
        budget: "25.00–45.00/hr",
        experience_level: "expert",
        duration: "1 to 3 months",
        proposals_tier: "5 to 10",
        published_date: "2026-09-28T10:00:00.000Z",
        client: { country: "United States", rating: 4.9, total_spent: "$7,233.56", total_posted_jobs: 12, total_reviews: 9, verification_status: "VERIFIED" },
      },
      {
        id: "2100000000000000002",
        title: "WordPress theme tweaks",
        url: "https://www.upwork.com/jobs/~022100000000000000002?utm_source=claude",
        description_snippet: "<untrusted_participant_content>\nSmall CSS fixes on a WordPress site.\n</untrusted_participant_content>",
        skills: ["WordPress", "CSS"],
        job_type: "fixed",
        budget: "50.00",
        experience_level: "intermediate",
        proposals_tier: "20 to 50",
        published_date: "2026-09-27T08:30:00.000Z",
        client: { country: "Canada", total_posted_jobs: 3 },
      },
    ],
  },
  get_messages: {
    status: "ok",
    hasMore: false,
    data: {
      rooms: [
        {
          id: "room_mock1",
          roomType: "INTERVIEW",
          roomName: "<untrusted_participant_content>\nMock Client\n</untrusted_participant_content>",
          numUnread: 1,
          last_message_from_self: false,
          latestStory: { id: "story_mock1", createdDateTime: hoursAgo(20), message: "<untrusted_participant_content>\nHi, can we talk tomorrow?\n</untrusted_participant_content>" },
        },
        {
          id: "room_mock2",
          roomType: "ONE_ON_ONE",
          numUnread: 0,
          last_message_from_self: true,
          latestStory: { id: "story_mock2", createdDateTime: hoursAgo(40), message: "<untrusted_participant_content>\nYou: Thanks for the invite!\n</untrusted_participant_content>" },
        },
      ],
    },
  },
  list_contracts: {
    status: "ok",
    hasMore: false,
    data: {
      vendorContracts: {
        contracts: [
          { id: "40000001", title: "Laravel REST API for booking app", status: "ACTIVE", offerId: "100000001", startDate: "2026-09-29T10:00:00.000Z", clientOrganization: { id: "9001", name: "Mock Client Co" } },
        ],
      },
    },
  },
  list_freelancer_proposals: {
    status: "ok",
    hasMore: false,
    data: { vendorProposals: { edges: [], pageInfo: { hasNextPage: false } } },
  },
  get_profile: (args: Record<string, unknown>) =>
    args.action === "connects_balance"
      ? { status: "ok", balance: { connectsBalance: 120, connectsBalanceFree: 60, connectsBalancePaid: 60 } }
      : {
          status: "ok",
          data: {
            personalData: {
              title: "<untrusted_participant_content>\nFull-Stack Developer | Laravel & Vue\n</untrusted_participant_content>",
              description: "<untrusted_participant_content>\nI build web apps.\n</untrusted_participant_content>",
              chargeRate: { currency: "USD", displayValue: "$25.0", rawValue: "25.0" },
              location: { country: "Pakistan", state: "IS" },
            },
            profileAggregates: { totalEarnings: "$1K+", totalJobs: 4 },
            skills: [{ id: "1", prettyName: "Laravel" }, { id: "2", prettyName: "Vue.js" }],
          },
        },
};

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): TransportResponse {
  const h = new Map(Object.entries({ "content-type": "application/json", ...headers }));
  return {
    status,
    headers: { get: (n) => h.get(n.toLowerCase()) ?? null },
    text: async () => (body === undefined ? "" : JSON.stringify(body)),
  };
}

export type MockTransportOptions = {
  tools?: string[];
  data?: Record<string, unknown>;
  failWith?: number; // HTTP status to return for every call (e.g. 401, 429)
  onCall?: (method: string, params: unknown, headers: Record<string, string>) => void;
};

export function mockTransport(opts: MockTransportOptions = {}): Transport {
  const tools = opts.tools ?? MOCK_TOOLS;
  const data = opts.data ?? MOCK_DATA;
  return async ({ headers, body }) => {
    const msg = body as { id?: number; method: string; params?: { name?: string; arguments?: Record<string, unknown> } };
    opts.onCall?.(msg.method, msg.params, headers);
    if (opts.failWith) return jsonResponse(opts.failWith, { error: "mock failure" });
    if (msg.id === undefined) return jsonResponse(202, undefined); // notification

    const ok = (result: unknown) => jsonResponse(200, { jsonrpc: "2.0", id: msg.id, result }, { "mcp-session-id": "mock-session" });
    switch (msg.method) {
      case "initialize":
        return ok({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "mock-upwork" } });
      case "tools/list":
        return ok({ tools: tools.map((name) => ({ name })) });
      case "tools/call": {
        const name = msg.params?.name ?? "";
        const base = name.split("__").pop()!;
        if (!tools.includes(name) || !(base in data)) {
          return jsonResponse(200, { jsonrpc: "2.0", id: msg.id, error: { code: -32602, message: "unknown tool" } });
        }
        // Like the live server: every tool except list_accounts requires action + org_uid.
        const args = msg.params?.arguments ?? {};
        if (base !== "list_accounts" && (!args.action || !args.org_uid)) {
          return jsonResponse(200, { jsonrpc: "2.0", id: msg.id, error: { code: -32602, message: "action and org_uid are required" } });
        }
        // A fixture may be a function of the call arguments (e.g. different answers per action).
        const fixture = data[base];
        const payload = typeof fixture === "function" ? (fixture as (a: Record<string, unknown>) => unknown)(args) : fixture;
        return ok({ content: [{ type: "text", text: JSON.stringify(payload) }] });
      }
      default:
        return jsonResponse(200, { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "method not found" } });
    }
  };
}

// Fake OAuth token/revoke endpoints.
export function mockOAuthFetch(opts: { invalidGrant?: boolean; expiresIn?: number } = {}): typeof fetch {
  let n = 0;
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === MOCK_META.revocation_endpoint) return new Response(null, { status: 200 });
    if (url === MOCK_META.token_endpoint) {
      if (opts.invalidGrant) return Response.json({ error: "invalid_grant" }, { status: 400 });
      n++;
      return Response.json({
        access_token: `mock-access-${n}`,
        refresh_token: `mock-refresh-${n}`,
        expires_in: opts.expiresIn ?? 3600,
        scope: "",
      });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}
