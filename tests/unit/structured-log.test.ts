import { afterEach, describe, expect, it, vi } from "vitest";

import {
  safeErrorType,
  writeStructuredLog,
} from "@/server/observability/structured-log";

afterEach(() => vi.restoreAllMocks());

describe("structured redacted logs", () => {
  it("emits bounded JSON and drops unknown or query-string fields", () => {
    const sink = vi.spyOn(console, "error").mockImplementation(() => undefined);
    writeStructuredLog("error", "http.request_failed", {
      errorType: "ProviderError",
      requestId: "trace_1234567890abcdef",
      route:
        "/api/v1/mail/messages/private-message-id?email=private@example.com",
      password: "never-log-this",
    } as never);
    const line = String(sink.mock.calls[0]?.[0]);
    expect(JSON.parse(line)).toMatchObject({
      errorType: "ProviderError",
      event: "http.request_failed",
      level: "error",
      requestId: "trace_1234567890abcdef",
      route: "/api/v1/mail/messages/:id",
      service: "veda-mail",
    });
    expect(line).not.toContain("private@example.com");
    expect(line).not.toContain("private-message-id");
    expect(line).not.toContain("never-log-this");
  });

  it("uses only the error class and never its message", () => {
    const error = new TypeError("secret token");
    expect(safeErrorType(error)).toBe("TypeError");
  });

  it("redacts dynamic identifiers even when they resemble a public route", () => {
    const sink = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    writeStructuredLog("warn", "provider.operation_failed", {
      route: "/api/v1/mail/messages/calendar/attachments/archive",
    });
    expect(JSON.parse(String(sink.mock.calls[0]?.[0])).route).toBe(
      "/api/v1/mail/messages/:id/attachments/archive",
    );
  });
});
