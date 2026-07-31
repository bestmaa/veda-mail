import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { StalwartProviderModule } from "@/infrastructure/providers/stalwart-jmap/stalwart-provider.module";
import {
  assertSafeProviderOrigin,
  isBlockedProviderAddress,
} from "@/infrastructure/providers/stalwart-jmap/provider-url-policy";
import { rateLimitSourceFor } from "@/server/security/rate-limit";

const original = {
  allowedHosts: process.env["VEDA_MAIL_ALLOWED_PROVIDER_HOSTS"],
  nodeEnv: process.env.NODE_ENV,
  trustProxy: process.env["VEDA_MAIL_TRUST_PROXY_HEADERS"],
};

const restore = (name: string, value: string | undefined): void => {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
};

beforeEach(() => {
  delete process.env["VEDA_MAIL_ALLOWED_PROVIDER_HOSTS"];
  Reflect.set(process.env, "NODE_ENV", "test");
  delete process.env["VEDA_MAIL_TRUST_PROXY_HEADERS"];
});

afterEach(() => {
  restore("VEDA_MAIL_ALLOWED_PROVIDER_HOSTS", original.allowedHosts);
  restore("NODE_ENV", original.nodeEnv);
  restore("VEDA_MAIL_TRUST_PROXY_HEADERS", original.trustProxy);
});

describe("provider security", () => {
  it("rejects deceptive localhost hostnames over HTTP", () => {
    expect(() =>
      new StalwartProviderModule().parseServiceConfig({
        baseUrl: "http://localhost.evil.example",
      }),
    ).toThrow("HTTPS");
  });

  it("enforces an optional provider host allowlist before fetching", async () => {
    process.env["VEDA_MAIL_ALLOWED_PROVIDER_HOSTS"] = "mail.example.com";
    await expect(
      assertSafeProviderOrigin("https://other.example.com"),
    ).rejects.toThrow("not allowed");
  });

  it("requires an explicit provider allowlist in production", async () => {
    Reflect.set(process.env, "NODE_ENV", "production");
    delete process.env["VEDA_MAIL_ALLOWED_PROVIDER_HOSTS"];
    await expect(
      assertSafeProviderOrigin("https://mail.example.com"),
    ).rejects.toThrow("VEDA_MAIL_ALLOWED_PROVIDER_HOSTS");
  });

  it("validates provider safety before accepting service settings", async () => {
    process.env["VEDA_MAIL_ALLOWED_PROVIDER_HOSTS"] = "mail.example.com";
    await expect(
      new StalwartProviderModule().validateServiceConfig({
        baseUrl: "https://other.example.com",
      }),
    ).rejects.toThrow("not allowed");
  });

  it("ignores spoofable forwarding headers unless explicitly trusted", () => {
    const request = new Request("https://mail.example.com", {
      headers: { "x-forwarded-for": "198.51.100.2, 203.0.113.8" },
    });
    delete process.env["VEDA_MAIL_TRUST_PROXY_HEADERS"];
    expect(rateLimitSourceFor(request)).toBeNull();

    process.env["VEDA_MAIL_TRUST_PROXY_HEADERS"] = "true";
    expect(rateLimitSourceFor(request)).toBe("203.0.113.8");
  });

  it.each([
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "0:0:0:0:0:ffff:7f00:1",
    "::ffff:a00:1",
    "::ffff:c0a8:1",
    "64:ff9b::7f00:1",
    "2002:7f00:1::",
  ])("rejects private IPv4 embedded in IPv6: %s", (address) => {
    expect(isBlockedProviderAddress(address)).toBe(true);
  });

  it("does not classify a mapped public IPv4 address as private", () => {
    expect(isBlockedProviderAddress("::ffff:808:808")).toBe(false);
  });

  it("rejects a mapped loopback provider URL before connecting", async () => {
    await expect(
      assertSafeProviderOrigin("https://[::ffff:7f00:1]"),
    ).rejects.toThrow("private network");
  });
});
