import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakePrisma } from "../helpers/fake-prisma";

const fake = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof import("../helpers/fake-prisma").createFakePrisma> }));
vi.mock("@/lib/prisma", () => ({
  get prisma() {
    return fake.db;
  },
}));

import { decryptSecret } from "@/lib/crypto";
import { ForbiddenError } from "@/lib/member-auth";
import {
  completeAuth,
  disconnect,
  publicStatus,
  refreshIfNeeded,
  startAuth,
  withMcp,
  type ConnectionDeps,
} from "@/lib/upwork/connection";
import { IntegrationDisabled, NoFreelancerAccount, NotConnected, OAuthStateMismatch, Revoked } from "@/lib/upwork/errors";
import { assertOwnConnection } from "@/lib/upwork/identity";
import { mockMode } from "@/lib/upwork/flags";
import { MOCK_DATA, MOCK_META, MOCK_ORG_UID, mockOAuthFetch, mockTransport } from "@/lib/upwork/mock";
import type { UpworkConnection } from "@prisma/client";

const deps = (o: Partial<ConnectionDeps> & { invalidGrant?: boolean } = {}): ConnectionDeps => ({
  meta: MOCK_META,
  fetchImpl: mockOAuthFetch({ invalidGrant: o.invalidGrant }),
  transport: o.transport ?? mockTransport(),
});

async function connect(memberId: string, d = deps()) {
  const { authorizeUrl } = await startAuth(memberId, d);
  const state = new URL(authorizeUrl).searchParams.get("state")!;
  return completeAuth(memberId, { code: "code-1", state }, d);
}

beforeEach(() => {
  fake.db = createFakePrisma();
  vi.stubEnv("UPWORK_MCP_ENABLED", "true");
  vi.stubEnv("UPWORK_MCP_MOCK", "");
  vi.stubEnv("UPWORK_OAUTH_CLIENT_ID", "client-abc");
  vi.stubEnv("UPWORK_OAUTH_REDIRECT_URI", "http://localhost:3000/api/me/upwork/callback");
});

describe("flag off", () => {
  it("refuses to start a connection or make calls", async () => {
    vi.stubEnv("UPWORK_MCP_ENABLED", "false");
    await expect(startAuth("m1", deps())).rejects.toBeInstanceOf(IntegrationDisabled);
    await expect(withMcp("m1", async () => 1, deps())).rejects.toBeInstanceOf(IntegrationDisabled);
  });
});

describe("startAuth", () => {
  it("builds a PKCE S256 authorize URL and stores the verifier encrypted", async () => {
    const { authorizeUrl } = await startAuth("m1", deps());
    const u = new URL(authorizeUrl);
    expect(u.origin + u.pathname).toBe(MOCK_META.authorization_endpoint);
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("client_id")).toBe("client-abc");
    expect(u.searchParams.get("resource")).toBe("https://mcp.upwork.test/mcp");

    const row = fake.db._connections.get("m1")!;
    expect(row.oauthState).toBe(u.searchParams.get("state"));
    // verifier is ciphertext, not the plain value
    const verifier = decryptSecret(row.oauthCodeVerifier as string);
    expect(row.oauthCodeVerifier).not.toBe(verifier);
    expect(verifier.length).toBeGreaterThan(40);
  });
});

describe("completeAuth", () => {
  it("rejects a mismatched state", async () => {
    await startAuth("m1", deps());
    await expect(completeAuth("m1", { code: "c", state: "wrong" }, deps())).rejects.toBeInstanceOf(OAuthStateMismatch);
  });

  it("stores tokens encrypted, records identity, clears PKCE state", async () => {
    const row = await connect("m1");
    expect(row.status).toBe("connected");
    expect(row.accessTokenEnc).not.toContain("mock-access");
    expect(decryptSecret(row.accessTokenEnc as string)).toBe("mock-access-1");
    expect(decryptSecret(row.refreshTokenEnc as string)).toBe("mock-refresh-1");
    expect(row.upworkAccountId).toBe(MOCK_ORG_UID); // the freelancer (TALENT) account, not the agency
    expect(row.accountName).toBe("Mock Freelancer");
    expect(row.oauthState).toBeNull();
    expect(row.oauthCodeVerifier).toBeNull();
  });

  it("refuses a login that has no freelancer account, and stores no token", async () => {
    const agencyOnly = { ...MOCK_DATA, list_accounts: { accounts: [{ name: "Agency", org_uid: "2", role: "FL_AGENCY" }] } };
    const d = deps({ transport: mockTransport({ data: agencyOnly }) });
    await expect(connect("m1", d)).rejects.toBeInstanceOf(NoFreelancerAccount);
    const row = fake.db._connections.get("m1")!;
    expect(row.status).toBe("error");
    expect(row.accessTokenEnc).toBeNull();
  });

  it("never exposes tokens in the public status", async () => {
    const row = await connect("m1");
    const status = JSON.stringify(publicStatus(row as UpworkConnection));
    expect(status).not.toMatch(/token|mock-access|mock-refresh/i);
  });

  it("refuses when another member already connected the same Upwork account", async () => {
    await connect("m1");
    await expect(connect("m2")).rejects.toBeInstanceOf(ForbiddenError);
    expect(fake.db._connections.get("m2")!.status).toBe("error");
    expect(fake.db._connections.get("m2")!.accessTokenEnc).toBeNull();
  });
});

describe("refresh / expiry / revoke", () => {
  it("refreshes an access token that is about to expire", async () => {
    const d = deps(); // one fake token server for connect + refresh
    await connect("m1", d);
    const row = await fake.db.upworkConnection.update({ where: { memberId: "m1" }, data: { tokenExpiresAt: new Date(Date.now() + 5_000) } });
    const token = await refreshIfNeeded(row as unknown as UpworkConnection, d);
    expect(token).toBe("mock-access-2");
    expect(decryptSecret(fake.db._connections.get("m1")!.accessTokenEnc as string)).toBe("mock-access-2");
  });

  it("marks the connection revoked and wipes tokens when refresh is rejected", async () => {
    await connect("m1");
    const row = await fake.db.upworkConnection.update({ where: { memberId: "m1" }, data: { tokenExpiresAt: new Date(Date.now() - 1_000) } });
    await expect(refreshIfNeeded(row as unknown as UpworkConnection, deps({ invalidGrant: true }))).rejects.toBeInstanceOf(Revoked);
    const after = fake.db._connections.get("m1")!;
    expect(after.status).toBe("revoked");
    expect(after.accessTokenEnc).toBeNull();
    expect(after.refreshTokenEnc).toBeNull();
  });

  it("marks revoked when the MCP server rejects the token mid-call", async () => {
    await connect("m1");
    await expect(withMcp("m1", async () => 1, deps({ transport: mockTransport({ failWith: 401 }) }))).rejects.toBeInstanceOf(Revoked);
    expect(fake.db._connections.get("m1")!.status).toBe("revoked");
  });
});

describe("withMcp + isolation", () => {
  it("needs a connection", async () => {
    await expect(withMcp("nobody", async () => 1, deps())).rejects.toBeInstanceOf(NotConnected);
  });

  it("runs the call with the member's own token and stamps lastSyncedAt", async () => {
    await connect("m1");
    const seen: string[] = [];
    const d = deps({ transport: mockTransport({ onCall: (_m, _p, h) => seen.push(h.Authorization) }) });
    const got = await withMcp("m1", async (c, orgUid) => ({ tool: await c.resolveTool("find_jobs"), orgUid }), d);
    expect(got).toEqual({ tool: "upwork__find_jobs", orgUid: MOCK_ORG_UID });
    expect(new Set(seen)).toEqual(new Set(["Bearer mock-access-1"]));
    expect(fake.db._connections.get("m1")!.lastSyncedAt).toBeInstanceOf(Date);
  });

  it("assertOwnConnection refuses another member's connection", () => {
    expect(() => assertOwnConnection({ memberId: "m1" }, "m2")).toThrow(ForbiddenError);
    expect(() => assertOwnConnection({ memberId: "m1" }, "m1")).not.toThrow();
  });
});

describe("disconnect", () => {
  it("clears tokens and sets disconnected, without ending the login to this app", async () => {
    await connect("m1");
    fake.db._members.set("m1", { id: "m1", sessionVersion: 0 });
    await disconnect("m1", deps());
    const row = fake.db._connections.get("m1")!;
    expect(row.status).toBe("disconnected");
    expect(row.accessTokenEnc).toBeNull();
    expect(row.refreshTokenEnc).toBeNull();
    expect(fake.db._members.get("m1")!.sessionVersion).toBe(0);
  });
});

describe("mock mode (local dev) with no OAuth env configured", () => {
  it("completes the full connect flow using only built-in mocks", async () => {
    vi.stubEnv("UPWORK_MCP_ENABLED", "false");
    vi.stubEnv("UPWORK_MCP_MOCK", "true");
    vi.stubEnv("UPWORK_OAUTH_CLIENT_ID", "");
    vi.stubEnv("UPWORK_OAUTH_REDIRECT_URI", "");
    const { authorizeUrl } = await startAuth("m1"); // no deps: mock mode supplies them
    const u = new URL(authorizeUrl);
    expect(u.pathname).toBe("/api/me/upwork/callback");
    const row = await completeAuth("m1", { code: u.searchParams.get("code")!, state: u.searchParams.get("state")! });
    expect(row.status).toBe("connected");
  });
});

describe("sign-in attempt lifetime", () => {
  it("cannot be completed after 10 minutes, and is cleared", async () => {
    const d = deps();
    const { authorizeUrl } = await startAuth("m1", d);
    const state = new URL(authorizeUrl).searchParams.get("state")!;
    fake.db._connections.get("m1")!.updatedAt = new Date(Date.now() - 11 * 60_000);
    await expect(completeAuth("m1", { code: "c", state }, d)).rejects.toBeInstanceOf(OAuthStateMismatch);
    expect(fake.db._connections.get("m1")!).toMatchObject({ oauthState: null, oauthCodeVerifier: null, accessTokenEnc: null });
  });

  it("is single-use even when the token exchange fails", async () => {
    const { authorizeUrl } = await startAuth("m1", deps());
    const state = new URL(authorizeUrl).searchParams.get("state")!;
    await expect(completeAuth("m1", { code: "bad", state }, deps({ invalidGrant: true }))).rejects.toBeTruthy();
    expect(fake.db._connections.get("m1")!.oauthState).toBeNull();
    await expect(completeAuth("m1", { code: "c", state }, deps())).rejects.toBeInstanceOf(OAuthStateMismatch);
  });
});

describe("a failed connect leaves nothing behind", () => {
  it("revokes BOTH new tokens at Upwork and keeps no token — not even an older one", async () => {
    await connect("m1"); // an earlier, healthy connection
    const revoked: string[] = [];
    const inner = mockOAuthFetch();
    const recording = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === MOCK_META.revocation_endpoint) revoked.push(new URLSearchParams(String(init?.body)).get("token")!);
      return inner(input, init);
    }) as typeof fetch;
    const agencyOnly = { ...MOCK_DATA, list_accounts: { accounts: [{ name: "Agency", org_uid: "2", role: "FL_AGENCY" }] } };
    const d = { meta: MOCK_META, fetchImpl: recording, transport: mockTransport({ data: agencyOnly }) };

    const { authorizeUrl } = await startAuth("m1", d);
    await expect(completeAuth("m1", { code: "c", state: new URL(authorizeUrl).searchParams.get("state")! }, d)).rejects.toBeInstanceOf(NoFreelancerAccount);

    expect(revoked).toEqual(["mock-refresh-1", "mock-access-1"]); // refresh token first
    expect(fake.db._connections.get("m1")!).toMatchObject({ status: "error", accessTokenEnc: null, refreshTokenEnc: null, tokenExpiresAt: null });
  });

  it("disconnect revokes both tokens too", async () => {
    await connect("m1");
    const revoked: string[] = [];
    const inner = mockOAuthFetch();
    const recording = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === MOCK_META.revocation_endpoint) revoked.push(new URLSearchParams(String(init?.body)).get("token")!);
      return inner(input, init);
    }) as typeof fetch;
    await disconnect("m1", { meta: MOCK_META, fetchImpl: recording, transport: mockTransport() });
    expect(revoked).toEqual(["mock-refresh-1", "mock-access-1"]);
  });
});

describe("two members, two connections", () => {
  it("each member's calls carry only their own token and their own account id", async () => {
    const orgFor: Record<string, string> = { "Bearer token-m1": "org-m1", "Bearer token-m2": "org-m2" };
    const seen: { auth: string; org?: unknown }[] = [];
    // A token server that hands out a different token per sign-in code, and an MCP server
    // that answers list_accounts according to the token it is shown.
    const fetchFor = (who: string) =>
      (async (input: RequestInfo | URL) =>
        String(input) === MOCK_META.token_endpoint
          ? Response.json({ access_token: `token-${who}`, refresh_token: `refresh-${who}`, expires_in: 3600 })
          : new Response(null, { status: 200 })) as typeof fetch;
    const transport = mockTransport({
      data: { ...MOCK_DATA, list_accounts: undefined as never },
      onCall: (method, params, headers) => {
        if (method === "tools/call") seen.push({ auth: headers.Authorization, org: (params as { arguments?: { org_uid?: string } }).arguments?.org_uid });
      },
    });
    // list_accounts must depend on the caller, so serve it from a wrapper.
    const perCaller: typeof transport = async (req) => {
      const msg = req.body as { id?: number; method: string; params?: { name?: string } };
      if (msg.method === "tools/call" && msg.params?.name === "upwork__list_accounts") {
        seen.push({ auth: req.headers.Authorization });
        const org = orgFor[req.headers.Authorization];
        return { status: 200, headers: { get: () => "application/json" }, text: async () => JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: JSON.stringify({ accounts: [{ name: org, org_uid: org, role: "TALENT" }] }) }] } }) };
      }
      return transport(req);
    };

    for (const who of ["m1", "m2"]) {
      const d = { meta: MOCK_META, fetchImpl: fetchFor(who), transport: perCaller };
      const { authorizeUrl } = await startAuth(who, d);
      await completeAuth(who, { code: who, state: new URL(authorizeUrl).searchParams.get("state")! }, d);
    }
    expect(fake.db._connections.get("m1")!.upworkAccountId).toBe("org-m1");
    expect(fake.db._connections.get("m2")!.upworkAccountId).toBe("org-m2");

    seen.length = 0;
    const d = { meta: MOCK_META, fetchImpl: fetchFor("x"), transport: perCaller };
    const a = await withMcp("m1", async (c, org) => { await c.callTool("find_jobs", { action: "search", org_uid: org, params: {} }); return org; }, d);
    const b = await withMcp("m2", async (c, org) => { await c.callTool("find_jobs", { action: "search", org_uid: org, params: {} }); return org; }, d);
    expect([a, b]).toEqual(["org-m1", "org-m2"]);
    expect(seen).toEqual([
      { auth: "Bearer token-m1", org: "org-m1" },
      { auth: "Bearer token-m2", org: "org-m2" },
    ]);
  });
});

describe("refresh under pressure", () => {
  it("two refreshes at once: the loser uses the winner's token instead of killing the connection", async () => {
    const d = deps();
    await connect("m1", d);
    const stale = { ...fake.db._connections.get("m1")!, tokenExpiresAt: new Date(Date.now() - 1000) } as unknown as UpworkConnection;
    fake.db._connections.set("m1", stale as never);
    // First request refreshes successfully (rotating the refresh token)…
    expect(await refreshIfNeeded(stale, d)).toBe("mock-access-2");
    // …the second still holds the old row and its refresh token is now rejected by Upwork.
    const token = await refreshIfNeeded(stale, deps({ invalidGrant: true }));
    expect(token).toBe("mock-access-2");
    expect(fake.db._connections.get("m1")!).toMatchObject({ status: "connected" });
    expect(fake.db._connections.get("m1")!.accessTokenEnc).not.toBeNull();
  });

  it("a genuinely revoked refresh token still ends as revoked", async () => {
    await connect("m1");
    const stale = { ...fake.db._connections.get("m1")!, tokenExpiresAt: new Date(Date.now() - 1000) } as unknown as UpworkConnection;
    fake.db._connections.set("m1", stale as never);
    await expect(refreshIfNeeded(stale, deps({ invalidGrant: true }))).rejects.toBeInstanceOf(Revoked);
    expect(fake.db._connections.get("m1")!.status).toBe("revoked");
  });

  it("a rejected token is refreshed once and the call retried, before giving up", async () => {
    const d = deps();
    await connect("m1", d);
    let rejectFirst = true;
    const inner = mockTransport();
    const flaky: typeof inner = async (req) => {
      if (rejectFirst && req.headers.Authorization === "Bearer mock-access-1") {
        return { status: 401, headers: { get: () => null }, text: async () => "" };
      }
      return inner(req);
    };
    rejectFirst = true;
    const org = await withMcp("m1", async (_c, o) => o, { ...d, transport: flaky });
    expect(org).toBe(MOCK_ORG_UID);
    expect(fake.db._connections.get("m1")!.status).toBe("connected");
    expect(decryptSecret(fake.db._connections.get("m1")!.accessTokenEnc as string)).toBe("mock-access-2");
  });

  it("a 403 on one request does not cost the member their connection", async () => {
    await connect("m1");
    await expect(withMcp("m1", async () => 1, deps({ transport: mockTransport({ failWith: 403 }) }))).rejects.toMatchObject({ code: "mcp_error" });
    const row = fake.db._connections.get("m1")!;
    expect(row.status).toBe("connected");
    expect(row.accessTokenEnc).not.toBeNull();
  });
});

describe("test mode can never be on in production", () => {
  it("UPWORK_MCP_MOCK is ignored when NODE_ENV=production", () => {
    vi.stubEnv("UPWORK_MCP_MOCK", "true");
    vi.stubEnv("NODE_ENV", "development");
    expect(mockMode()).toBe(true);
    vi.stubEnv("NODE_ENV", "production");
    expect(mockMode()).toBe(false);
  });

  it("…so with the real flag off, production refuses to connect or call anything", async () => {
    vi.stubEnv("UPWORK_MCP_ENABLED", "false");
    vi.stubEnv("UPWORK_MCP_MOCK", "true");
    vi.stubEnv("NODE_ENV", "production");
    await expect(startAuth("m1")).rejects.toBeInstanceOf(IntegrationDisabled);
    await expect(withMcp("m1", async () => 1)).rejects.toBeInstanceOf(IntegrationDisabled);
  });
});
