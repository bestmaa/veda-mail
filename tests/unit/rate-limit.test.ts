import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import {
  assertRequestRateLimit,
  assertSubjectRateLimit,
} from "@/server/security/rate-limit";

const originalTrust = process.env["VEDA_MAIL_TRUST_PROXY_HEADERS"];

afterEach(() => {
  if (originalTrust === undefined) {
    delete process.env["VEDA_MAIL_TRUST_PROXY_HEADERS"];
  } else {
    process.env["VEDA_MAIL_TRUST_PROXY_HEADERS"] = originalTrust;
  }
});

const request = () =>
  new Request("https://mail.example.com", {
    headers: { "x-forwarded-for": "198.51.100.8" },
  });

describe("rate limiter", () => {
  it("isolates low limits by hashed account when proxy IPs are untrusted", () => {
    delete process.env["VEDA_MAIL_TRUST_PROXY_HEADERS"];
    const scope = `account-${randomUUID()}`;

    assertRequestRateLimit(request(), scope, 20, 2, 60_000);
    assertSubjectRateLimit(scope, "alice@example.com", 1, 60_000);
    assertRequestRateLimit(request(), scope, 20, 2, 60_000);
    assertSubjectRateLimit(scope, "bob@example.com", 1, 60_000);

    expect(() =>
      assertSubjectRateLimit(scope, "alice@example.com", 1, 60_000),
    ).toThrow("Too many requests");
  });

  it("enforces a separate high global safety cap", () => {
    const scope = `global-${randomUUID()}`;
    assertRequestRateLimit(request(), scope, 2, 2, 60_000);
    assertRequestRateLimit(request(), scope, 2, 2, 60_000);

    expect(() =>
      assertRequestRateLimit(request(), scope, 2, 2, 60_000),
    ).toThrow("Too many requests");
  });

  it("atomically charges weighted subject work", () => {
    const scope = `weighted-${randomUUID()}`;
    const subject = `mailbox-${randomUUID()}`;

    assertSubjectRateLimit(scope, subject, 10, 60_000, 4);
    assertSubjectRateLimit(scope, subject, 10, 60_000, 6);

    expect(() =>
      assertSubjectRateLimit(scope, subject, 10, 60_000, 1),
    ).toThrow("Too many requests");
  });

  it("rejects invalid or over-limit weighted work without storing raw subjects", () => {
    const scope = `weighted-reject-${randomUUID()}`;
    const subject = `private-${randomUUID()}@example.com`;

    expect(() =>
      assertSubjectRateLimit(scope, subject, 5, 60_000, 6),
    ).toThrow("Too many requests");
    expect(() =>
      assertSubjectRateLimit(scope, subject, 5, 60_000, 0),
    ).toThrow("positive integer");

    const state = globalThis as typeof globalThis & {
      __vedaMailRateLimits?: Map<string, unknown>;
    };
    expect(
      [...(state.__vedaMailRateLimits?.keys() ?? [])].some((key) =>
        key.includes(subject),
      ),
    ).toBe(false);
  });

  it("never stores raw account identifiers in window keys", () => {
    const scope = `hashed-${randomUUID()}`;
    const identifier = `private-${randomUUID()}@example.com`;
    assertSubjectRateLimit(scope, identifier, 2, 60_000);
    const state = globalThis as typeof globalThis & {
      __vedaMailRateLimits?: Map<string, unknown>;
    };

    expect(
      [...(state.__vedaMailRateLimits?.keys() ?? [])].some((key) =>
        key.includes(identifier),
      ),
    ).toBe(false);
  });

  it("uses a trusted source bucket only when explicitly enabled", () => {
    const scope = `source-${randomUUID()}`;
    process.env["VEDA_MAIL_TRUST_PROXY_HEADERS"] = "true";
    assertRequestRateLimit(request(), scope, 10, 1, 60_000);

    expect(() =>
      assertRequestRateLimit(request(), scope, 10, 1, 60_000),
    ).toThrow("Too many requests");
  });
});
