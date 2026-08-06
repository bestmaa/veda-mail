import { describe, expect, it, vi } from "vitest";

import { readinessSnapshot } from "@/server/observability/readiness";

describe("readiness snapshot", () => {
  it("reports only bounded check names and readiness", async () => {
    await expect(
      readinessSnapshot({
        checkData: vi.fn().mockResolvedValue(undefined),
        checkScanner: vi.fn().mockResolvedValue(undefined),
      }),
    ).resolves.toMatchObject({
      checks: [
        { name: "data", status: "ok" },
        { name: "scanner", status: "ok" },
      ],
      service: "veda-mail",
      status: "ready",
    });
  });

  it("fails closed without exposing dependency errors", async () => {
    const snapshot = await readinessSnapshot({
      checkData: vi.fn().mockResolvedValue(undefined),
      checkScanner: vi.fn().mockRejectedValue(new Error("private host")),
    });
    expect(snapshot).toMatchObject({
      checks: [
        { name: "data", status: "ok" },
        { name: "scanner", status: "failed" },
      ],
      status: "degraded",
    });
    expect(JSON.stringify(snapshot)).not.toContain("private host");
  });
});
