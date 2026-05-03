import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  outputFileTracingRoot: join(__dirname, "../.."),

  // Proxy /api/dashboard → agent server so the frontend never needs CORS.
  // Set AGENT_URL in .env.local (local dev) or as an env var in deployment.
  // Falls back to localhost:3001 if not set.
  async rewrites() {
    const agentUrl = process.env.AGENT_URL ?? "http://localhost:3001";
    return [
      {
        source: "/api/dashboard",
        destination: `${agentUrl}/dashboard`,
      },
    ];
  },
};

export default nextConfig;
