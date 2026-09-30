// Minimal MCP client over Streamable HTTP (JSON-RPC 2.0): initialize, tools/list, tools/call.
// No SDK dependency. The transport is injectable so tests never hit Upwork.
// Tool names are never assumed: callers resolve them against the live tools/list.

import { logInfo } from "@/lib/log";
import { McpProtocolError, RateLimited, Revoked, ToolNotAllowed, ToolUnavailable } from "@/lib/upwork/errors";

// The ONLY Upwork tools this app may call — all read-only. Anything that drafts, submits,
// sends or confirms is deliberately absent, so such a call cannot be added by accident.
// Each tool is limited to the read actions this app uses: a tool name alone would not stop
// an action of that tool that changes something.
export const READ_ONLY_ACTIONS: Readonly<Record<string, readonly string[]>> = {
  list_accounts: [], // takes no action
  find_jobs: ["search", "smart_search"],
  get_messages: ["list_rooms"],
  list_contracts: ["search"],
  list_freelancer_proposals: ["list", "get"],
  get_profile: ["get", "connects_balance"],
};
export const READ_ONLY_TOOLS: ReadonlySet<string> = new Set(Object.keys(READ_ONLY_ACTIONS));

const REQUEST_TIMEOUT_MS = 20_000;

export const MCP_PROTOCOL_VERSION = "2025-06-18";

export type McpTool = { name: string; description?: string; inputSchema?: unknown };

export type McpToolResult = {
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: unknown;
  isError?: boolean;
};

export type TransportRequest = {
  url: string;
  headers: Record<string, string>;
  body: unknown;
};
export type TransportResponse = {
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
};
export type Transport = (req: TransportRequest) => Promise<TransportResponse>;

export const fetchTransport: Transport = async ({ url, headers, body }) =>
  fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });

// Streamable HTTP may answer with plain JSON or an SSE stream; take the JSON-RPC message
// that answers our request id.
function parseRpcBody(text: string, contentType: string | null, id: number) {
  try {
    return parseRpcBodyUnsafe(text, contentType, id);
  } catch (err) {
    if (err instanceof McpProtocolError) throw err;
    throw new McpProtocolError("Response was not valid JSON"); // e.g. an HTML error page
  }
}

function parseRpcBodyUnsafe(text: string, contentType: string | null, id: number) {
  if (contentType?.includes("text/event-stream")) {
    for (const block of text.split(/\r?\n\r?\n/)) {
      const data = block
        .split(/\r?\n/)
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (!data) continue;
      const msg = JSON.parse(data);
      if (msg?.id === id) return msg;
    }
    throw new McpProtocolError("No response for request in event stream");
  }
  return text ? JSON.parse(text) : null;
}

export type McpClientOptions = {
  // 429 handling (handover §11 Q4): retry a few times, honouring Retry-After, capped so a
  // request never hangs; then surface RateLimited.
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
};

const MAX_BACKOFF_MS = 5_000;

export class McpClient {
  private nextId = 1;
  private sessionId: string | null = null;
  private tools: McpTool[] | null = null;
  private readonly maxRetries: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly url: string,
    private readonly accessToken: string,
    private readonly transport: Transport = fetchTransport,
    opts: McpClientOptions = {},
  ) {
    this.maxRetries = opts.maxRetries ?? 2;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${this.accessToken}`,
      "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
    };
    if (this.sessionId) h["Mcp-Session-Id"] = this.sessionId;
    return h;
  }

  private async rpc(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++;
    const body = { jsonrpc: "2.0", id, method, ...(params !== undefined && { params }) };
    let res = await this.transport({ url: this.url, headers: this.headers(), body });
    for (let attempt = 0; res.status === 429 && attempt < this.maxRetries; attempt++) {
      const ra = Number(res.headers.get("retry-after"));
      const wait = Number.isFinite(ra) && ra > 0 ? ra * 1000 : 500 * 2 ** attempt;
      await this.sleep(Math.min(wait, MAX_BACKOFF_MS));
      res = await this.transport({ url: this.url, headers: this.headers(), body });
    }

    // 401 = the token is no longer accepted. 403 = this one request is not permitted;
    // that must not cost the member their whole connection.
    if (res.status === 401) throw new Revoked();
    if (res.status === 403) throw new McpProtocolError("MCP HTTP 403 (forbidden)");
    if (res.status === 429) {
      const ra = Number(res.headers.get("retry-after"));
      throw new RateLimited(Number.isFinite(ra) ? ra : undefined);
    }
    if (res.status >= 400) throw new McpProtocolError(`MCP HTTP ${res.status}`);

    const sid = res.headers.get("mcp-session-id");
    if (sid) this.sessionId = sid;

    const msg = parseRpcBody(await res.text(), res.headers.get("content-type"), id);
    if (msg?.error) throw new McpProtocolError(`MCP ${method}: ${msg.error.message ?? "error"}`);
    return msg?.result;
  }

  private async notify(method: string): Promise<void> {
    await this.transport({
      url: this.url,
      headers: this.headers(),
      body: { jsonrpc: "2.0", method },
    });
  }

  async initialize(): Promise<void> {
    await this.rpc("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "upwork-tracker", version: "1.0.0" },
    });
    await this.notify("notifications/initialized");
  }

  async listTools(): Promise<McpTool[]> {
    if (this.tools) return this.tools;
    const result = (await this.rpc("tools/list")) as { tools?: McpTool[] } | undefined;
    this.tools = result?.tools ?? [];
    logInfo("upwork-mcp", "discovered tools", { tools: this.tools.map((t) => t.name) });
    return this.tools;
  }

  // Resolve a base name ("find_jobs") to the server's actual tool name, which may be
  // namespaced ("upwork__find_jobs"). Throws ToolUnavailable if the server doesn't offer it.
  async resolveTool(baseName: string): Promise<string> {
    const tools = await this.listTools();
    const hit =
      tools.find((t) => t.name === baseName) ??
      tools.find((t) => t.name.endsWith(`__${baseName}`) || t.name.endsWith(`.${baseName}`));
    if (!hit) throw new ToolUnavailable(baseName);
    return hit.name;
  }

  async callTool(baseName: string, args: Record<string, unknown> = {}): Promise<McpToolResult> {
    if (!READ_ONLY_TOOLS.has(baseName)) throw new ToolNotAllowed(baseName);
    const action = args.action;
    if (action !== undefined && !(typeof action === "string" && READ_ONLY_ACTIONS[baseName].includes(action))) {
      throw new ToolNotAllowed(`${baseName}:${String(action)}`);
    }
    const name = await this.resolveTool(baseName);
    const result = (await this.rpc("tools/call", { name, arguments: args })) as McpToolResult;
    if (result?.isError) throw new McpProtocolError(`Tool ${baseName} returned an error`);
    return result;
  }
}
