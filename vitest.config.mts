import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": import.meta.dirname } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Tests never hit Upwork or a real DB: MCP via mock transport, Prisma via an in-memory fake.
    env: {
      APP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
      UPWORK_MCP_URL: "https://mcp.upwork.test/mcp",
    },
  },
});
