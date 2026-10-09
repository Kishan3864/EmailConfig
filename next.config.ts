import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf-parse", "imapflow", "nodemailer", "mailparser", "xlsx", "firebase-admin"],
  experimental: { serverActions: { bodySizeLimit: "20mb" } },
};

export default nextConfig;
