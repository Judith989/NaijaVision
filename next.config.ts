import type { NextConfig } from "next";

const isGitHubPages = process.env.GITHUB_ACTIONS === "true";

const nextConfig: NextConfig = {
  ...(isGitHubPages
    ? {
        output: "export" as const,
        basePath: "/NaijaVision",
        images: { unoptimized: true },
      }
    : {}),
};

export default nextConfig;
