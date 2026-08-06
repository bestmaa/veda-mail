import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import nextConfig from "../../next.config";
import { config, proxy } from "@/proxy";
import {
  CSP_REQUEST_NONCE_HEADER,
  DOCUMENT_CACHE_CONTROL,
  DOCUMENT_REFERRER_POLICY,
} from "@/server/http/document-security-policy";

const configuredHeaders = async () => {
  if (!nextConfig.headers) throw new Error("Next headers are not configured.");
  return nextConfig.headers();
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("global security header configuration", () => {
  it("emits host-only HSTS exactly once in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const rules = await configuredHeaders();
    const headers = rules.flatMap((rule) => rule.headers);

    expect(
      headers.filter(({ key }) => key === "Strict-Transport-Security"),
    ).toEqual([
      {
        key: "Strict-Transport-Security",
        value: "max-age=31536000",
      },
    ]);
    expect(headers.some(({ key }) => key === "Referrer-Policy")).toBe(false);
  });

  it("does not pin an HTTP development origin into HSTS", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const rules = await configuredHeaders();

    expect(
      rules
        .flatMap((rule) => rule.headers)
        .some(({ key }) => key === "Strict-Transport-Security"),
    ).toBe(false);
  });

  it("serves the root service worker without reusable HTTP caching", async () => {
    const rules = await configuredHeaders();
    const worker = rules.find(({ source }) => source === "/sw.js");
    expect(worker?.headers).toEqual([
      { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
      { key: "Service-Worker-Allowed", value: "/" },
    ]);
  });
});

describe("document security proxy", () => {
  it("adds a bounded correlation ID to API requests and responses", () => {
    const response = proxy(
      new NextRequest("https://mail.example/api/health", {
        headers: { "x-request-id": "trace_1234567890abcdef" },
      }),
    );
    expect(response.headers.get("x-request-id")).toBe(
      "trace_1234567890abcdef",
    );
    expect(response.headers.get("x-middleware-request-x-request-id")).toBe(
      "trace_1234567890abcdef",
    );
    expect(response.headers.get("content-security-policy")).toBeNull();
  });

  it("sets matching response and downstream request policies", () => {
    const response = proxy(new NextRequest("https://mail.example/"));
    const policy = response.headers.get("content-security-policy");
    const downstreamPolicy = response.headers.get(
      "x-middleware-request-content-security-policy",
    );
    const nonce = response.headers.get(
      `x-middleware-request-${CSP_REQUEST_NONCE_HEADER}`,
    );

    expect(policy).not.toBeNull();
    expect(downstreamPolicy).toBe(policy);
    expect(nonce).toMatch(/^[A-Za-z0-9_-]{22}$/u);
    expect(policy).toContain(`'nonce-${nonce}'`);
    expect(response.headers.get("referrer-policy")).toBe(
      DOCUMENT_REFERRER_POLICY,
    );
    expect(response.headers.get("cache-control")).toBe(DOCUMENT_CACHE_CONTROL);
    expect(response.headers.has(CSP_REQUEST_NONCE_HEADER)).toBe(false);
  });

  it("overwrites attacker-supplied nonce and policy request headers", () => {
    const response = proxy(
      new NextRequest("https://mail.example/", {
        headers: {
          "content-security-policy": "script-src 'nonce-attacker'",
          "x-nonce": "attacker",
        },
      }),
    );
    const policy = response.headers.get(
      "x-middleware-request-content-security-policy",
    );
    const nonce = response.headers.get(
      `x-middleware-request-${CSP_REQUEST_NONCE_HEADER}`,
    );

    expect(nonce).toMatch(/^[A-Za-z0-9_-]{22}$/u);
    expect(nonce).not.toBe("attacker");
    expect(policy).toContain(`'nonce-${nonce}'`);
    expect(policy).not.toContain("nonce-attacker");
  });

  it.each([
    ["/", true],
    ["/setup", true],
    ["/admin", true],
    ["/admin/login", true],
    ["/api/health", true],
    ["/api/v1/mail/workspace", true],
    ["/_next/static/chunk.js", false],
    ["/_next/image?url=%2Fog.png", false],
    ["/favicon.ico", false],
    ["/og.png", false],
    ["/fonts/brand.woff2", false],
  ])("matches %s only when it is a document candidate", (pathname, expected) => {
    expect(
      unstable_doesMiddlewareMatch({
        config,
        url: `https://mail.example${pathname}`,
      }),
    ).toBe(expected);
  });

  it("skips speculative prefetch requests", () => {
    expect(
      unstable_doesMiddlewareMatch({
        config,
        headers: { purpose: "prefetch" },
        url: "https://mail.example/admin",
      }),
    ).toBe(false);
    expect(
      unstable_doesMiddlewareMatch({
        config,
        headers: { "next-router-prefetch": "1" },
        url: "https://mail.example/admin",
      }),
    ).toBe(false);
  });
});
