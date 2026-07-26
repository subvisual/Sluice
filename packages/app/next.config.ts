import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    // The 0G SDK's ESM build is broken (loaded via createRequire in the
    // arbitration-sdk) — keep it external so Next never tries to bundle it.
    "@0gfoundation/0g-compute-ts-sdk",
    // @reown/appkit-adapter-wagmi's connector helpers dynamically
    // `import("@wagmi/connectors")`, whose baseAccount.js dynamically
    // imports @base-org/account -> @coinbase/cdp-sdk. cdp-sdk's
    // signX402Payment.js in turn does dynamic `import("@x402/*")` for
    // scheme packages that are declared as OPTIONAL peer deps and are
    // intentionally not installed (we never sign x402 payments). Next's
    // Turbopack server build still tries to statically resolve those
    // dynamic imports and fails ("Module not found: Can't resolve
    // '@x402/...'"); marking cdp-sdk external skips that static
    // resolution and defers to a real (still-guarded, try/catch'd at
    // each call site) Node `require` at runtime, which no-ops cleanly.
    // Delete once @coinbase/cdp-sdk stops eagerly wiring up x402 for
    // consumers who never call it, or Next stops statically resolving
    // dynamic imports inside externalized packages.
    "@coinbase/cdp-sdk",
  ],
  turbopack: {
    // Turbopack does not resolve files outside the project root, and the token
    // list lives in `config/addresses.8453.json` at the monorepo root — ONE
    // file shared by the fork and by mainnet, so the app reads it rather than
    // keeping a second copy in sync.
    root: path.join(__dirname, "..", ".."),
    resolveAlias: {
      // @reown/appkit-adapter-wagmi declares `@wagmi/connectors` as an
      // unbounded OPTIONAL peer (">=5.9.9"), so npm resolves and hoists
      // the newest matching major (8.x, built for wagmi 3 / @wagmi/core
      // 3.x) to the workspace root node_modules — shadowing the correct,
      // wagmi-2-compatible 6.x copy nested under wagmi's own
      // node_modules. The hoisted 8.x barrel statically re-exports from
      // '@wagmi/core/tempo', a subpath that doesn't exist in the
      // @wagmi/core@2.x this app is pinned to (root package.json
      // "overrides"), so both the client and server bundles fail with
      // "Module not found: Can't resolve '@wagmi/core/tempo'". Alias the
      // bare specifier back to the nested, version-correct copy that
      // ships alongside wagmi itself. Delete once @reown/appkit-adapter-
      // wagmi bounds its optional @wagmi/connectors range to a wagmi-2-
      // compatible major, or this app moves to wagmi 3.
      "@wagmi/connectors": "../../node_modules/wagmi/node_modules/@wagmi/connectors",
    },
  },
};

export default nextConfig;
