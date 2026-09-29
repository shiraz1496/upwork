import type { NextConfig } from "next";

// The dashboard calls its own API same-origin; the only cross-origin caller was the
// (removed) extension. Allow just APP_BASE_URL — never "*" on a cookie-authenticated API.
const appOrigin = process.env.APP_BASE_URL ? new URL(process.env.APP_BASE_URL).origin : null;

const nextConfig: NextConfig = {
  async headers() {
    if (!appOrigin) return [];
    return [
      {
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: appOrigin },
          { key: "Access-Control-Allow-Methods", value: "GET, POST, PATCH, DELETE, OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Content-Type" },
          { key: "Vary", value: "Origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
