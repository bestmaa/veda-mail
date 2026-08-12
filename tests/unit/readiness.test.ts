import { describe, expect, it, vi } from "vitest";

import { readinessSnapshot } from "@/server/observability/readiness";

describe("readiness snapshot", () => {
  it("reports only bounded check names and readiness", async () => {
    await expect(
      readinessSnapshot({
        checkData: vi.fn().mockResolvedValue(undefined),
        checkRateLimitStore: vi.fn().mockResolvedValue(undefined),
        checkScanner: vi.fn().mockResolvedValue(undefined),
        checkSessionStore: vi.fn().mockResolvedValue(undefined),
      }),
    ).resolves.toMatchObject({
      checks: [
        { name: "data", status: "ok" },
        { name: "scanner", status: "ok" },
        { name: "session-store", status: "ok" },
        { name: "rate-limit-store", status: "ok" },
      ],
      service: "veda-mail",
      status: "ready",
    });
  });

  it("fails closed without exposing dependency errors", async () => {
    const snapshot = await readinessSnapshot({
      checkData: vi.fn().mockResolvedValue(undefined),
      checkRateLimitStore: vi.fn().mockResolvedValue(undefined),
      checkScanner: vi.fn().mockRejectedValue(new Error("private host")),
      checkSessionStore: vi.fn().mockResolvedValue(undefined),
    });
    expect(snapshot).toMatchObject({
      checks: [
        { name: "data", status: "ok" },
        { name: "scanner", status: "failed" },
        { name: "session-store", status: "ok" },
        { name: "rate-limit-store", status: "ok" },
      ],
      status: "degraded",
    });
    expect(JSON.stringify(snapshot)).not.toContain("private host");
  });
});
