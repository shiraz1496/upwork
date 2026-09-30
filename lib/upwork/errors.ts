// Typed errors for the Upwork layer, mapped to safe HTTP responses. Never include tokens.

export class UpworkError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus: number,
  ) {
    super(message);
  }
}

export class IntegrationDisabled extends UpworkError {
  constructor() {
    super("disabled", "Upwork integration is disabled pending Upwork approval", 503);
  }
}
export class NotConfigured extends UpworkError {
  constructor(what: string) {
    super("not_configured", `Upwork OAuth is not configured (${what})`, 503);
  }
}
export class NotConnected extends UpworkError {
  constructor() {
    super("not_connected", "Connect your Upwork account first", 409);
  }
}
export class ConnectionExpired extends UpworkError {
  constructor() {
    super("expired", "Upwork connection expired — reconnect", 401);
  }
}
export class Revoked extends UpworkError {
  constructor() {
    super("revoked", "Upwork access was revoked — reconnect", 401);
  }
}
export class RateLimited extends UpworkError {
  constructor(readonly retryAfterSec?: number) {
    super("rate_limited", "Upwork rate limit hit — try again shortly", 429);
  }
}
export class ToolUnavailable extends UpworkError {
  constructor(tool: string) {
    super("tool_unavailable", `Upwork MCP tool "${tool}" is not available`, 502);
  }
}
export class OAuthStateMismatch extends UpworkError {
  constructor() {
    super("state_mismatch", "OAuth state did not match — start the connection again", 400);
  }
}
export class NoFreelancerAccount extends UpworkError {
  constructor() {
    super("no_freelancer_account", "This Upwork login has no freelancer account", 400);
  }
}
// The detail shown to users is fixed; Upwork's own error text stays server-side (`upstream`).
export class McpProtocolError extends UpworkError {
  readonly upstream: string;
  constructor(upstream: string) {
    super("mcp_error", "Upwork returned an unexpected response", 502);
    this.upstream = upstream.slice(0, 200);
  }
}
export class ToolNotAllowed extends UpworkError {
  constructor(tool: string) {
    super("tool_not_allowed", `This app does not call the Upwork tool "${tool}"`, 500);
  }
}

export function upworkErrorResponse(err: UpworkError): Response {
  return Response.json({ error: err.code, detail: err.message }, { status: err.httpStatus });
}
