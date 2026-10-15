import type { NextConfig } from "next";
const nextConfig: NextConfig = { distDir: process.env.REPOCARE_BUILD_DIR || '.next', turbopack: { root: process.cwd() }, serverExternalPackages: ['node:sqlite'] };
export default nextConfig;
