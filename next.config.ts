import type { NextConfig } from "next";
import { GITBOOK_PROXY_ORIGIN, LEGACY_DOCUMENTATION } from "./lib/documentation";

export function createContentSecurityPolicy(isDevelopment: boolean) {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    [
      "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
      isDevelopment ? "'unsafe-eval'" : "",
      "https://auth.privy.io",
      "https://*.privy.io",
      "https://challenges.cloudflare.com",
      "https://hcaptcha.com",
      "https://*.hcaptcha.com",
    ].filter(Boolean).join(" "),
    "script-src-attr 'none'",
    [
      "style-src 'self' 'unsafe-inline'",
      "https://hcaptcha.com",
      "https://*.hcaptcha.com",
    ].join(" "),
    "img-src 'self' blob: data: https:",
    "font-src 'self' data: https:",
    [
      "connect-src 'self' https: wss:",
      isDevelopment ? "http: ws:" : "",
    ].filter(Boolean).join(" "),
    [
      "frame-src 'self'",
      "https://dexscreener.com",
      "https://auth.privy.io",
      "https://*.privy.io",
      "https://verify.walletconnect.com",
      "https://verify.walletconnect.org",
      "https://*.walletconnect.com",
      "https://*.walletconnect.org",
      "https://challenges.cloudflare.com",
      "https://hcaptcha.com",
      "https://*.hcaptcha.com",
    ].join(" "),
    "worker-src 'self' blob:",
    "media-src 'self' blob: data: https:",
    "manifest-src 'self'",
    ...(isDevelopment ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

const contentSecurityPolicy = createContentSecurityPolicy(
  process.env.NODE_ENV === "development",
);

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: contentSecurityPolicy,
  },
  {
    key: "Permissions-Policy",
    value: "browsing-topics=(), camera=(), geolocation=(), microphone=()",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
];

export const sharpRuntimeFiles = [
  "./node_modules/sharp/**/*",
  "./node_modules/@img/**/*",
];

const customAIWorkerFiles = [
  "./scripts/custom-ai/compile-worker.mjs", "./scripts/custom-ai/lifecycle-worker.mjs",
  "./scripts/custom-ai/artifact-hash.mjs", "./scripts/custom-ai/composable-module.mjs",
  "./scripts/custom-ai/validate-module.mjs", "./scripts/custom-ai/validate-lifecycle.mjs",
  "./scripts/custom-ai/core-bundle.json", "./scripts/custom-ai/toolchain/node_modules/**/*",
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingIncludes: {
    "/api/custom-ai": customAIWorkerFiles,
    "/api/custom-ai/preview": customAIWorkerFiles,
    "/api/custom-ai/image": sharpRuntimeFiles,
    "/api/token-image": sharpRuntimeFiles,
    "/api/prediction/asset-logo/*": sharpRuntimeFiles,
    "/api/profile/projects/*/article/media": sharpRuntimeFiles,
  },
  async headers() {
    return [
      {
        // GitBook serves its own application and security policy under /docs.
        // Website-only script restrictions must not block its scripts or search.
        source: "/:path((?!docs(?:/|$)).*)",
        headers: securityHeaders,
      },
    ];
  },
  async redirects() {
    return [
      {
        source: "/swap",
        destination: "/explore",
        permanent: true,
      },
      { source: "/llms.txt", destination: "/docs/llms.txt", permanent: false },
      { source: "/llms-full.txt", destination: "/docs/llms-full.txt", permanent: false },
      {
        source: "/docs/developers/module-mode-indexing.md",
        destination: "/developers/module-mode-indexing-v1.md",
        permanent: false,
      },
      {
        source: "/docs/developers/custom-launch.md",
        destination: "/developers/custom-launch-api-v1.md",
        permanent: false,
      },
      {
        source: "/docs/developers.md",
        destination: "/docs/developers/developers.md",
        permanent: false,
      },
      ...Object.entries(LEGACY_DOCUMENTATION).flatMap(([source, destination]) => {
        const [page, hash] = destination.split("#");
        return [
          { source, destination, permanent: false },
          ...source.startsWith("/docs/")
            && !["/docs/developers/custom-launch", "/docs/developers/module-mode-indexing"].includes(source)
            ? [{ source: `${source}.md`, destination: `${page}.md${hash ? `#${hash}` : ""}`, permanent: false }]
            : [],
        ];
      }),
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.programmable.market" }],
        destination: "https://programmable.market/:path*",
        permanent: true,
      },
    ];
  },
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: "/docs.md",
          destination: `${GITBOOK_PROXY_ORIGIN}/.md`,
        },
        {
          source: "/docs",
          destination: GITBOOK_PROXY_ORIGIN,
        },
        {
          source: "/docs/:path*",
          destination: `${GITBOOK_PROXY_ORIGIN}/:path*`,
        },
      ],
    };
  },
};

export default nextConfig;
