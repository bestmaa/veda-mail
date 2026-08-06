import { describe, expect, it } from "vitest";

import {
  normalizeRequestId,
  resolveRequestId,
} from "@/transport/http/request-id";

describe("request correlation identifiers", () => {
  it("keeps bounded caller identifiers and rejects injection", () => {
    expect(normalizeRequestId("trace_1234567890abcdef")).toBe(
      "trace_1234567890abcdef",
    );
    expect(normalizeRequestId("short")).toBeNull();
    expect(normalizeRequestId("trace_1234567890\r\nx-secret: value")).toBeNull();
  });

  it("creates a server identifier when the caller value is invalid", () => {
    expect(resolveRequestId("bad", () => "server_generated_123456")).toBe(
      "server_generated_123456",
    );
  });
});
