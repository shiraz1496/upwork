import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    "5707-2407-d000-1a-8e89-d1ac-1694-a188-6c83.ngrok-free.app",
    "2454-2407-d000-1a-8e89-d1ac-1694-a188-6c83.ngrok-free.app",
    "*.ngrok-free.app",
    "*.ngrok.io"
  ],
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET, POST, OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Content-Type" },
        ],
      },
    ];
  },
};

export default nextConfig;
