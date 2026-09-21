import type { NextConfig } from "next";
const nextConfig: NextConfig = { turbopack: { root: process.cwd() }, serverExternalPackages: ['node:sqlite'] };
export default nextConfig;
