import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The 0G SDK's ESM build is broken (loaded via createRequire in the
  // arbitration-sdk) — keep it external so Next never tries to bundle it.
  serverExternalPackages: ["@0gfoundation/0g-compute-ts-sdk"],
  turbopack: {
    // Turbopack does not resolve files outside the project root, and the token
    // list lives in `config/addresses.8453.json` at the monorepo root — F1 §1
    // is explicit that it is ONE file shared by the fork and by mainnet, so the
    // app reads it rather than keeping a second copy in sync.
    root: path.join(__dirname, "..", ".."),
  },
};

export default nextConfig;
