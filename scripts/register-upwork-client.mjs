/**
 * register-upwork-client.mjs
 *
 * One-time OAuth client registration with the Upwork MCP server.
 * Upwork's MCP docs (https://www.upwork.com/ai/mcp): "Authentication uses OAuth 2.1 with
 * dynamic client registration." This performs that registration (RFC 7591) and prints the
 * client_id to put in UPWORK_OAUTH_CLIENT_ID.
 *
 * The registration endpoint is discovered at runtime from the MCP server's metadata
 * (RFC 9728 → RFC 8414), never hardcoded.
 *
 * This creates a real registration at Upwork — run it deliberately, once per environment:
 *   node scripts/register-upwork-client.mjs --redirect-uri https://upwork-tracking-tool.vercel.app/api/me/upwork/callback --dry-run
 *   node scripts/register-upwork-client.mjs --redirect-uri https://upwork-tracking-tool.vercel.app/api/me/upwork/callback
 */

const MCP_URL = process.env.UPWORK_MCP_URL || "https://mcp.upwork.com/mcp";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const redirectUri = arg("redirect-uri");
const dryRun = process.argv.includes("--dry-run");
if (!redirectUri) {
  console.error("Usage: node scripts/register-upwork-client.mjs --redirect-uri <url> [--dry-run]");
  process.exit(1);
}

const resource = new URL(MCP_URL);
const prm = await fetch(`${resource.origin}/.well-known/oauth-protected-resource${resource.pathname}`).then((r) =>
  r.ok ? r.json() : null,
);
const issuer = prm?.authorization_servers?.[0] ?? resource.origin;
const meta = await fetch(`${new URL(issuer).origin}/.well-known/oauth-authorization-server`).then((r) =>
  r.ok ? r.json() : null,
);
if (!meta?.registration_endpoint) {
  console.error("Upwork's OAuth metadata has no registration_endpoint — dynamic registration unavailable.");
  process.exit(1);
}

// Public client + PKCE (server advertises token_endpoint_auth_method "none").
const request = {
  client_name: "Upwork Tracker",
  redirect_uris: [redirectUri],
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
  token_endpoint_auth_method: "none",
};

console.log(`Registration endpoint: ${meta.registration_endpoint}`);
console.log("Request:", JSON.stringify(request, null, 2));
if (dryRun) {
  console.log("Dry run — nothing sent.");
  process.exit(0);
}

const res = await fetch(meta.registration_endpoint, {
  method: "POST",
  headers: { "Content-Type": "application/json", Accept: "application/json" },
  body: JSON.stringify(request),
});
const body = await res.json().catch(() => null);
if (!res.ok || !body?.client_id) {
  console.error(`Registration failed (HTTP ${res.status}):`, body?.error ?? "", body?.error_description ?? "");
  process.exit(1);
}

console.log("\nRegistered. Set these in the environment (Vercel + .env.local):");
console.log(`  UPWORK_OAUTH_CLIENT_ID=${body.client_id}`);
if (body.client_secret) {
  console.log(`  UPWORK_OAUTH_CLIENT_SECRET=${body.client_secret}   <- shown once, store it now`);
}
console.log(`  UPWORK_OAUTH_REDIRECT_URI=${redirectUri}`);
