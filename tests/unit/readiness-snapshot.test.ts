import { describe, expect, it, vi } from "vitest";

import { readinessSnapshot } from "@/server/observability/readiness";

describe("readiness dependency snapshot", () => {
  it("requires data, scanner, and configured shared session storage", async () => {
    const snapshot = await readinessSnapshot({
      checkData: vi.fn().mockResolvedValue(undefined),
      checkRateLimitStore: vi.fn().mockResolvedValue(undefined),
      checkScanner: vi.fn().mockResolvedValue(undefined),
      checkSessionStore: vi.fn().mockRejectedValue(new Error("redis unavailable")),
    });
    expect(snapshot.status).toBe("degraded");
    expect(snapshot.checks).toEqual([
      { name: "data", status: "ok" },
      { name: "scanner", status: "ok" },
      { name: "session-store", status: "failed" },
      { name: "rate-limit-store", status: "ok" },
    ]);
  });
});
