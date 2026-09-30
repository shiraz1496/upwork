// Per-member Upwork connection handling (handover Phase D).
// Status: disconnected → (connect) → connected → expired | revoked | error → (reconnect) → connected
// Tokens are encrypted at rest (lib/crypto) and never leave this module in plain form.

import { timingSafeEqual } from "node:crypto";
import type { UpworkConnection } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { logError } from "@/lib/log";
import { ForbiddenError } from "@/lib/member-auth";
import { McpClient, type Transport, fetchTransport } from "@/lib/upwork/client";
import {
  ConnectionExpired,
  IntegrationDisabled,
  McpProtocolError,
  NoFreelancerAccount,
  NotConnected,
  OAuthStateMismatch,
  Revoked,
  UpworkError,
} from "@/lib/upwork/errors";
import { mcpEnabled, mcpUrl, mockMode } from "@/lib/upwork/flags";
import { assertAccountNotClaimed, assertOwnConnection, fetchIdentity, type Identity } from "@/lib/upwork/identity";
import { MOCK_META, mockOAuthFetch, mockTransport } from "@/lib/upwork/mock";
import {
  type AuthServerMetadata,
  buildAuthorizeUrl,
  createPkce,
  discover,
  exchangeCode,
  oauthConfig,
  refreshTokens,
  revokeToken,
} from "@/lib/upwork/oauth";

export type ConnectionDeps = {
  fetchImpl?: typeof fetch;
  transport?: Transport;
  meta?: AuthServerMetadata;
};

const REFRESH_SKEW_MS = 60_000;
// A "Connect Upwork" attempt must be finished within this time.
const OAUTH_STATE_TTL_MS = 10 * 60_000;

// Best effort: revoke the refresh token first (it can mint new access tokens), then the
// access token. A failure here must never block the local clean-up.
async function revokeAll(
  meta: AuthServerMetadata,
  tokens: { accessToken: string | null; refreshToken: string | null },
  fetchImpl: typeof fetch,
) {
  for (const token of [tokens.refreshToken, tokens.accessToken]) {
    if (!token) continue;
    try {
      await revokeToken(meta, token, fetchImpl);
    } catch (err) {
      logError("upwork revoke", err);
    }
  }
}

function resolveDeps(deps: ConnectionDeps = {}) {
  if (mockMode()) {
    return {
      fetchImpl: deps.fetchImpl ?? mockOAuthFetch(),
      transport: deps.transport ?? mockTransport(),
      getMeta: async () => deps.meta ?? MOCK_META,
    };
  }
  return {
    fetchImpl: deps.fetchImpl ?? fetch,
    transport: deps.transport ?? fetchTransport,
    getMeta: async () => deps.meta ?? discover(deps.fetchImpl ?? fetch),
  };
}

function assertEnabled() {
  if (!mcpEnabled() && !mockMode()) throw new IntegrationDisabled();
}

// Safe-to-send view of a connection (no tokens, no PKCE state).
export function publicStatus(c: UpworkConnection | null) {
  return {
    status: c?.status ?? "disconnected",
    accountName: c?.accountName ?? null,
    connectedAt: c?.connectedAt ?? null,
    lastSyncedAt: c?.lastSyncedAt ?? null,
    lastError: c?.lastError ?? null,
  };
}

export function getConnection(memberId: string) {
  return prisma.upworkConnection.findUnique({ where: { memberId } });
}

export async function startAuth(memberId: string, deps?: ConnectionDeps): Promise<{ authorizeUrl: string }> {
  assertEnabled();
  const { getMeta } = resolveDeps(deps);
  const meta = await getMeta();
  const { clientId, redirectUri } = oauthConfig();
  const pkce = createPkce();
  const { verifier, challenge } = pkce;
  // The state carries the time the attempt started, so its lifetime does not depend on
  // anything else that later writes to this row.
  const state = `${Date.now().toString(36)}.${pkce.state}`;

  await prisma.upworkConnection.upsert({
    where: { memberId },
    create: { memberId, oauthState: state, oauthCodeVerifier: encryptSecret(verifier) },
    update: { oauthState: state, oauthCodeVerifier: encryptSecret(verifier) },
  });

  if (mockMode()) {
    // No real Upwork consent screen: jump straight to our callback with a fake code.
    const u = new URL(redirectUri);
    u.searchParams.set("code", "mock-code");
    u.searchParams.set("state", state);
    return { authorizeUrl: u.toString() };
  }
  return { authorizeUrl: buildAuthorizeUrl(meta, { clientId, redirectUri, state, challenge }) };
}

function sameState(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function completeAuth(
  memberId: string,
  params: { code: string; state: string },
  deps?: ConnectionDeps,
) {
  assertEnabled();
  const { fetchImpl, transport, getMeta } = resolveDeps(deps);
  const row = await getConnection(memberId);
  if (!row?.oauthState || !row.oauthCodeVerifier || !sameState(row.oauthState, params.state)) {
    throw new OAuthStateMismatch();
  }
  const verifier = decryptSecret(row.oauthCodeVerifier);
  const startedAt = parseInt(row.oauthState.split(".")[0], 36);
  const expired = !Number.isFinite(startedAt) || Date.now() - startedAt > OAUTH_STATE_TTL_MS;
  // A sign-in attempt is single-use: clear it before talking to Upwork, so neither a
  // failure further down nor a replayed callback can use it again. The clear names the
  // state it expects, so of two callbacks arriving together only one goes on.
  const claimed = await prisma.upworkConnection.updateMany({
    where: { memberId, oauthState: row.oauthState },
    data: { oauthState: null, oauthCodeVerifier: null },
  });
  if (claimed.count === 0 || expired) throw new OAuthStateMismatch();

  const meta = await getMeta();
  const tokens = await exchangeCode(meta, params.code, verifier, fetchImpl);

  // Identify the freelancer account behind the token. Required: its org_uid goes into
  // every later tool call. On any failure the new tokens are revoked and NO token is kept
  // (not even one from an earlier connection).
  const reject = async (lastError: string) => {
    await revokeAll(meta, tokens, fetchImpl);
    if (row.accessTokenEnc) {
      await revokeAll(
        meta,
        { accessToken: decryptSecret(row.accessTokenEnc), refreshToken: row.refreshTokenEnc ? decryptSecret(row.refreshTokenEnc) : null },
        fetchImpl,
      ).catch((err) => logError("upwork revoke", err));
    }
    await prisma.upworkConnection.update({
      where: { memberId },
      data: { status: "error", lastError, accessTokenEnc: null, refreshTokenEnc: null, tokenExpiresAt: null },
    });
  };
  let identity: Identity;
  try {
    const client = new McpClient(mcpUrl(), tokens.accessToken, transport);
    await client.initialize();
    identity = await fetchIdentity(client);
  } catch (err) {
    await reject("Could not read the Upwork account — try connecting again");
    throw err;
  }
  if (!identity.upworkAccountId) {
    await reject("This Upwork login has no freelancer account");
    throw new NoFreelancerAccount();
  }
  try {
    await assertAccountNotClaimed(identity.upworkAccountId, memberId);
  } catch (err) {
    await reject("This Upwork account is already connected by another team member");
    throw err;
  }
  // The account is free (nobody else is connected to it). A member who used it before and
  // is no longer connected gives up the claim, so two members never resolve to one account.
  await prisma.upworkConnection.updateMany({
    where: { upworkAccountId: identity.upworkAccountId, memberId: { not: memberId }, status: { not: "connected" } },
    data: { upworkAccountId: null, accountName: null },
  });

  return prisma.upworkConnection.update({
    where: { memberId },
    data: {
      status: "connected",
      accessTokenEnc: encryptSecret(tokens.accessToken),
      refreshTokenEnc: tokens.refreshToken ? encryptSecret(tokens.refreshToken) : null,
      tokenExpiresAt: tokens.expiresAt,
      scopes: tokens.scopes,
      upworkAccountId: identity.upworkAccountId,
      accountName: identity.name,
      connectedAt: new Date(),
      lastSyncedAt: null,
      lastError: null,
      oauthState: null,
      oauthCodeVerifier: null,
    },
  });
}

async function markStatus(memberId: string, status: "expired" | "revoked" | "error", lastError: string) {
  await prisma.upworkConnection.update({
    where: { memberId },
    data: {
      status,
      lastError,
      ...(status === "revoked" && { accessTokenEnc: null, refreshTokenEnc: null, tokenExpiresAt: null }),
    },
  });
}

// Returns a usable access token, refreshing it first if it is about to expire
// (or regardless, with `force`, when Upwork has just rejected the current one).
export async function refreshIfNeeded(
  conn: UpworkConnection,
  deps?: ConnectionDeps,
  opts: { force?: boolean } = {},
): Promise<string> {
  if (conn.status !== "connected" || !conn.accessTokenEnc) throw new NotConnected();
  const fresh = !conn.tokenExpiresAt || conn.tokenExpiresAt.getTime() - Date.now() > REFRESH_SKEW_MS;
  if (fresh && !opts.force) return decryptSecret(conn.accessTokenEnc);

  if (!conn.refreshTokenEnc) {
    await markStatus(conn.memberId, "expired", "Upwork session expired — reconnect");
    throw new ConnectionExpired();
  }
  const { fetchImpl, getMeta } = resolveDeps(deps);
  try {
    const tokens = await refreshTokens(await getMeta(), decryptSecret(conn.refreshTokenEnc), fetchImpl);
    // Upwork accepted the refresh, so the connection is good — say so, in case another
    // request of this member lost the race for the single-use refresh token and marked it
    // revoked a moment ago. A connection the bidder disconnected meanwhile stays that way.
    const saved = await prisma.upworkConnection.updateMany({
      where: { memberId: conn.memberId, status: { not: "disconnected" } },
      data: {
        status: "connected",
        accessTokenEnc: encryptSecret(tokens.accessToken),
        refreshTokenEnc: tokens.refreshToken ? encryptSecret(tokens.refreshToken) : conn.refreshTokenEnc,
        tokenExpiresAt: tokens.expiresAt,
        lastError: null,
      },
    });
    if (saved.count === 0) {
      await revokeAll(await getMeta(), tokens, fetchImpl).catch((err) => logError("upwork revoke", err));
      throw new NotConnected();
    }
    return tokens.accessToken;
  } catch (err) {
    if (err instanceof Revoked || err instanceof ConnectionExpired) {
      // Refresh tokens are single-use. If another request of the same member refreshed a
      // moment ago, ours was rejected for that reason only — use the token it saved
      // instead of throwing away a healthy connection.
      const latest = await getConnection(conn.memberId);
      if (latest?.status === "connected" && latest.accessTokenEnc && latest.refreshTokenEnc !== conn.refreshTokenEnc) {
        return decryptSecret(latest.accessTokenEnc);
      }
    }
    if (err instanceof Revoked) await markStatus(conn.memberId, "revoked", "Upwork access was revoked — reconnect");
    else if (err instanceof ConnectionExpired) await markStatus(conn.memberId, "expired", "Upwork session expired — reconnect");
    throw err;
  }
}

export async function disconnect(memberId: string, deps?: ConnectionDeps) {
  const row = await getConnection(memberId);
  if (!row) return;
  if (row.accessTokenEnc && (mcpEnabled() || mockMode())) {
    const { fetchImpl, getMeta } = resolveDeps(deps);
    try {
      await revokeAll(
        await getMeta(),
        {
          accessToken: decryptSecret(row.accessTokenEnc),
          refreshToken: row.refreshTokenEnc ? decryptSecret(row.refreshTokenEnc) : null,
        },
        fetchImpl,
      );
    } catch (err) {
      logError("upwork revoke", err);
    }
  }
  // The Upwork access is removed; the member's login to this app is a separate thing and
  // stays as it is. (The handover §10.4 also bumped sessionVersion here, which signed the
  // bidder out of the dashboard for no security benefit — deliberately not done.)
  await prisma.upworkConnection.update({
    where: { memberId },
    data: {
      status: "disconnected",
      accessTokenEnc: null,
      refreshTokenEnc: null,
      tokenExpiresAt: null,
      oauthState: null,
      oauthCodeVerifier: null,
      scopes: [],
      lastError: null,
      lastSyncedAt: null,
    },
  });
}

// "Last refreshed": the member's proposal outcomes (submitted / offered / hired) were read
// from Upwork just now. The dashboards treat "hired" as known only from this moment — a
// job search or a profile read says nothing about hires.
export async function markOutcomesRead(memberId: string) {
  await prisma.upworkConnection.update({ where: { memberId }, data: { lastSyncedAt: new Date() } });
}

// The single gate for live MCP calls: flag → own connection → fresh token → client → fn.
// `orgUid` is the member's own freelancer account; every Upwork tool call needs it.
export async function withMcp<T>(
  memberId: string,
  fn: (client: McpClient, orgUid: string) => Promise<T>,
  deps?: ConnectionDeps,
): Promise<T> {
  assertEnabled();
  const conn = await getConnection(memberId);
  if (!conn || !conn.upworkAccountId) throw new NotConnected();
  assertOwnConnection(conn, memberId);
  const orgUid = conn.upworkAccountId;

  const run = async (token: string) => {
    const client = new McpClient(mcpUrl(), token, resolveDeps(deps).transport);
    await client.initialize();
    return fn(client, orgUid);
  };
  try {
    let result: T;
    try {
      result = await run(await refreshIfNeeded(conn, deps));
    } catch (err) {
      // Upwork rejected a token that looked valid (no expiry given, or it ended early).
      // Try one refresh before concluding the connection is gone. `fn` only reads.
      if (!(err instanceof Revoked) || !conn.refreshTokenEnc) throw err;
      result = await run(await refreshIfNeeded(conn, deps, { force: true }));
    }
    await prisma.upworkConnection.update({ where: { memberId }, data: { lastError: null } });
    return result;
  } catch (err) {
    if (err instanceof Revoked) await markStatus(memberId, "revoked", "Upwork access was revoked — reconnect");
    else if (err instanceof UpworkError) {
      await prisma.upworkConnection.update({ where: { memberId }, data: { lastError: err.message } });
      if (err instanceof McpProtocolError) logError("upwork mcp", err, { upstream: err.upstream });
    }
    else if (!(err instanceof ForbiddenError)) logError("upwork withMcp", err);
    throw err;
  }
}
