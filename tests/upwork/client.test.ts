import { describe, expect, it } from "vitest";
import { McpClient, type Transport } from "@/lib/upwork/client";
import { McpProtocolError, RateLimited, Revoked, ToolUnavailable } from "@/lib/upwork/errors";
import { mockTransport } from "@/lib/upwork/mock";

const URL_ = "https://mcp.upwork.test/mcp";

describe("McpClient", () => {
  it("initializes, sends bearer + protocol headers, and reuses the session id", async () => {
    const calls: { method: string; headers: Record<string, string> }[] = [];
    const client = new McpClient(URL_, "tok-123", mockTransport({ onCall: (method, _p, headers) => calls.push({ method, headers }) }));
    await client.initialize();
    await client.listTools();

    expect(calls.map((c) => c.method)).toEqual(["initialize", "notifications/initialized", "tools/list"]);
    expect(calls[0].headers.Authorization).toBe("Bearer tok-123");
    expect(calls[0].headers["MCP-Protocol-Version"]).toBeTruthy();
    expect(calls[0].headers["Mcp-Session-Id"]).toBeUndefined();
    expect(calls[2].headers["Mcp-Session-Id"]).toBe("mock-session");
  });

  it("resolves namespaced tool names from tools/list instead of assuming them", async () => {
    const client = new McpClient(URL_, "t", mockTransport());
    await client.initialize();
    expect(await client.resolveTool("find_jobs")).toBe("upwork__find_jobs");
  });

  it("refuses tools the server does not list", async () => {
    const client = new McpClient(URL_, "t", mockTransport({ tools: ["upwork__get_account"] }));
    await client.initialize();
    await expect(client.callTool("find_jobs")).rejects.toBeInstanceOf(ToolUnavailable);
  });

  it("maps 401 to Revoked", async () => {
    await expect(new McpClient(URL_, "t", mockTransport({ failWith: 401 })).initialize()).rejects.toBeInstanceOf(Revoked);
  });

  it("backs off on 429 honouring Retry-After (capped), then gives up with RateLimited", async () => {
    const waits: number[] = [];
    let calls = 0;
    const always429: Transport = async () => {
      calls++;
      return { status: 429, headers: { get: (n: string) => (n === "retry-after" ? "30" : null) }, text: async () => "" };
    };
    const client = new McpClient(URL_, "t", always429, { sleep: async (ms) => void waits.push(ms) });
    await expect(client.initialize()).rejects.toBeInstanceOf(RateLimited);
    expect(calls).toBe(3); // 1 try + 2 retries
    expect(waits).toEqual([5000, 5000]); // Retry-After 30s capped to 5s
  });

  it("recovers when a retry after 429 succeeds", async () => {
    let n = 0;
    const inner = mockTransport();
    const flaky: Transport = async (req) => {
      if (n++ === 0) return { status: 429, headers: { get: () => null }, text: async () => "" };
      return inner(req);
    };
    const client = new McpClient(URL_, "t", flaky, { sleep: async () => {} });
    await client.initialize();
    expect(await client.resolveTool("find_jobs")).toBe("upwork__find_jobs");
  });

  it("parses a JSON-RPC answer delivered as an SSE stream", async () => {
    const sse: Transport = async ({ body }) => {
      const id = (body as { id?: number }).id;
      const text = `event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\n\nevent: message\ndata: {"jsonrpc":"2.0","id":${id},"result":{"tools":[{"name":"find_jobs"}]}}\n\n`;
      return { status: 200, headers: { get: (n: string) => (n === "content-type" ? "text/event-stream" : null) }, text: async () => text };
    };
    const client = new McpClient(URL_, "t", sse);
    expect((await client.listTools()).map((t) => t.name)).toEqual(["find_jobs"]);
  });

  it("an HTML / non-JSON reply becomes McpProtocolError, not a crash", async () => {
    const html: Transport = async () => ({ status: 200, headers: { get: () => "text/html" }, text: async () => "<html>Bad gateway</html>" });
    await expect(new McpClient(URL_, "t", html).initialize()).rejects.toBeInstanceOf(McpProtocolError);
  });

  it("403 is an error for that request only — it does not mean the connection is revoked", async () => {
    const p = new McpClient(URL_, "t", mockTransport({ failWith: 403 })).initialize();
    await expect(p).rejects.toBeInstanceOf(McpProtocolError);
    await expect(p).rejects.not.toBeInstanceOf(Revoked);
  });

  it("never shows Upwork's own error text to the user (kept server-side as `upstream`)", async () => {
    const leaky: Transport = async ({ body }) => ({
      status: 200,
      headers: { get: () => "application/json" },
      text: async () => JSON.stringify({ jsonrpc: "2.0", id: (body as { id: number }).id, error: { code: -1, message: "internal stack trace at db-host-7" } }),
    });
    const err = await new McpClient(URL_, "t", leaky).listTools().catch((e) => e);
    expect(err).toBeInstanceOf(McpProtocolError);
    expect(err.message).toBe("Upwork returned an unexpected response");
    expect(err.upstream).toContain("db-host-7");
  });

  it("surfaces JSON-RPC errors as McpProtocolError", async () => {
    const client = new McpClient(URL_, "t", mockTransport({ data: {} }));
    await client.initialize();
    await expect(client.callTool("find_jobs")).rejects.toBeInstanceOf(McpProtocolError);
  });
});
