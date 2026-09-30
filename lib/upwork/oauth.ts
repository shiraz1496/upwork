// OAuth 2.1 + PKCE for the Upwork MCP server.
//
// Per Upwork's MCP docs (https://www.upwork.com/ai/mcp, read 2026-09-29):
//   - "Authentication uses OAuth 2.1 with dynamic client registration."
//     → register once with scripts/register-upwork-client.mjs, then set UPWORK_OAUTH_CLIENT_ID.
//   - "Today, connecting grants the full set of scopes." → no `scope` parameter is sent.
//   - Revoking in Account Settings → Connected Apps "immediately invalidates the access and
//     refresh tokens" → a 401 from the server marks the connection revoked.
// Endpoints are read at runtime from the server's discovery documents, never hardcoded.
// Seen on 2026-09-29:
//   authorization_endpoint https://www.upwork.com/ab/account-security/oauth2/authorize
//   token_endpoint         https://www.upwork.com/api/v3/oauth2/token
//   revocation_endpoint    https://www.upwork.com/api/v3/oauth2/token/revoke
//   registration_endpoint  https://www.upwork.com/register
//   code_challenge_methods S256
// Not yet exercised against the live server (needs a registered client + a real account);
// keep UPWORK_MCP_ENABLED off until that is done and Upwork approves hosted-client use.

import { createHash, randomBytes } from "node:crypto";
import { mcpUrl, mockMode } from "@/lib/upwork/flags";
import { ConnectionExpired, McpProtocolError, NotConfigured, Revoked } from "@/lib/upwork/errors";

export type AuthServerMetadata = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  revocation_endpoint?: string;
  registration_endpoint?: string;
  code_challenge_methods_supported?: string[];
};

export type TokenSet = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  scopes: string[];
};

type Fetch = typeof fetch;

export function oauthConfig() {
  if (mockMode()) {
    const base = process.env.APP_BASE_URL ?? "http://localhost:3000";
    return { clientId: "mock-client", clientSecret: null, redirectUri: `${base}/api/me/upwork/callback` };
  }
  const clientId = process.env.UPWORK_OAUTH_CLIENT_ID;
  const redirectUri = process.env.UPWORK_OAUTH_REDIRECT_URI;
  if (!clientId) throw new NotConfigured("UPWORK_OAUTH_CLIENT_ID");
  if (!redirectUri) throw new NotConfigured("UPWORK_OAUTH_REDIRECT_URI");
  return { clientId, clientSecret: process.env.UPWORK_OAUTH_CLIENT_SECRET || null, redirectUri };
}

// RFC 9728 protected-resource metadata → RFC 8414 authorization-server metadata.
export async function discover(fetchImpl: Fetch = fetch): Promise<AuthServerMetadata> {
  const resource = new URL(mcpUrl());
  const prm = await fetchImpl(
    `${resource.origin}/.well-known/oauth-protected-resource${resource.pathname}`,
  ).then((r) => (r.ok ? r.json() : null));
  const issuer: string = prm?.authorization_servers?.[0] ?? resource.origin;

  const meta = await fetchImpl(`${new URL(issuer).origin}/.well-known/oauth-authorization-server`).then(
    (r) => (r.ok ? r.json() : null),
  );
  if (!meta?.authorization_endpoint || !meta?.token_endpoint) {
    throw new McpProtocolError("Upwork OAuth discovery failed");
  }
  if (meta.code_challenge_methods_supported && !meta.code_challenge_methods_supported.includes("S256")) {
    throw new McpProtocolError("Upwork OAuth server does not support PKCE S256");
  }
  // Tokens and the consent page must only ever go over https.
  for (const endpoint of [meta.authorization_endpoint, meta.token_endpoint, meta.revocation_endpoint]) {
    if (endpoint && new URL(endpoint).protocol !== "https:") {
      throw new McpProtocolError("Upwork OAuth discovery returned a non-https endpoint");
    }
  }
  return meta;
}

export function createPkce() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge, state: randomBytes(24).toString("base64url") };
}

export function buildAuthorizeUrl(
  meta: AuthServerMetadata,
  p: { clientId: string; redirectUri: string; state: string; challenge: string },
): string {
  const u = new URL(meta.authorization_endpoint);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", p.clientId);
  u.searchParams.set("redirect_uri", p.redirectUri);
  u.searchParams.set("state", p.state);
  u.searchParams.set("code_challenge", p.challenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("resource", mcpUrl()); // RFC 8707, required by the MCP auth spec
  return u.toString();
}

async function tokenRequest(
  meta: AuthServerMetadata,
  form: Record<string, string>,
  fetchImpl: Fetch,
): Promise<TokenSet> {
  const { clientId, clientSecret } = oauthConfig();
  const body = new URLSearchParams({ ...form, client_id: clientId, resource: mcpUrl() });
  if (clientSecret) body.set("client_secret", clientSecret);

  const res = await fetchImpl(meta.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
    signal: AbortSignal.timeout(20_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (json?.error === "invalid_grant") throw form.grant_type === "refresh_token" ? new Revoked() : new ConnectionExpired();
    throw new McpProtocolError(`Token endpoint HTTP ${res.status}`);
  }
  if (!json.access_token) throw new McpProtocolError("Token response had no access_token");
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresAt:
      Number.isFinite(Number(json.expires_in)) && Number(json.expires_in) > 0
        ? new Date(Date.now() + Number(json.expires_in) * 1000)
        : null,
    scopes: typeof json.scope === "string" ? json.scope.split(" ").filter(Boolean) : [],
  };
}

export function exchangeCode(
  meta: AuthServerMetadata,
  code: string,
  verifier: string,
  fetchImpl: Fetch = fetch,
): Promise<TokenSet> {
  return tokenRequest(
    meta,
    { grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: oauthConfig().redirectUri },
    fetchImpl,
  );
}

export function refreshTokens(
  meta: AuthServerMetadata,
  refreshToken: string,
  fetchImpl: Fetch = fetch,
): Promise<TokenSet> {
  return tokenRequest(meta, { grant_type: "refresh_token", refresh_token: refreshToken }, fetchImpl);
}

// Best effort: revocation failure must not block a local disconnect.
export async function revokeToken(
  meta: AuthServerMetadata,
  token: string,
  fetchImpl: Fetch = fetch,
): Promise<boolean> {
  if (!meta.revocation_endpoint) return false;
  const { clientId, clientSecret } = oauthConfig();
  const body = new URLSearchParams({ token, client_id: clientId });
  if (clientSecret) body.set("client_secret", clientSecret);
  const res = await fetchImpl(meta.revocation_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  }).catch(() => null);
  return !!res?.ok;
}
