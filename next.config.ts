import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingIncludes: {
    "/*": [
      "./node_modules/@img/colour/**/*",
      "./node_modules/@img/sharp-*/**/*",
      "./node_modules/sharp/**/*",
    ],
  },
  outputFileTracingExcludes: {
    "/*": [
      "./.github/**/*",
      "./data/**/*",
      "./docs/**/*",
      "./scripts/**/*",
      "./src/**/*",
      "./tests/**/*",
      "./CHANGELOG.md",
      "./CODE_OF_CONDUCT.md",
      "./CONTRIBUTING.md",
      "./README.md",
      "./SECURITY.md",
      "./TRADEMARKS.md",
      "./compose.yaml",
      "./eslint.config.mjs",
      "./tsconfig.json",
      "./vitest.config.ts",
    ],
  },
  poweredByHeader: false,
  reactStrictMode: true,
  serverExternalPackages: ["imapflow", "mailparser"],
  turbopack: {
    root: process.cwd(),
  },
  webpack(config, { nextRuntime }) {
    if (nextRuntime === "edge") {
      config.resolve.alias = {
        ...config.resolve.alias,
        "./server/scheduled-send/scheduled-send-worker$": false,
        imapflow: false,
        mailparser: false,
        nodemailer: false,
      };
    }
    return config;
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          ...(process.env["NODE_ENV"] === "production"
            ? [
                {
                  key: "Strict-Transport-Security",
                  value: "max-age=31536000",
                },
              ]
            : []),
        ],
      },
    ];
  },
};

export default nextConfig;
