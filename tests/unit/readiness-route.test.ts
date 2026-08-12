import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/ready/route";
import { resetObservabilityMetricsForTests } from "@/server/observability/metrics";
import { readinessSnapshot } from "@/server/observability/readiness";

vi.mock("@/server/observability/readiness", () => ({
  readinessSnapshot: vi.fn(),
}));

const snapshot = (status: "degraded" | "ready") => ({
  checks: [
    { name: "data" as const, status: "ok" as const },
    {
      name: "scanner" as const,
      status: status === "ready" ? ("ok" as const) : ("failed" as const),
    },
    { name: "session-store" as const, status: "ok" as const },
    { name: "rate-limit-store" as const, status: "ok" as const },
  ],
  durationMs: 1,
  service: "veda-mail",
  status,
  timestamp: "2026-08-06T00:00:00.000Z",
});

beforeEach(resetObservabilityMetricsForTests);

describe("GET /api/ready", () => {
  it("returns 200 only when every dependency is ready", async () => {
    vi.mocked(readinessSnapshot).mockResolvedValueOnce(snapshot("ready"));
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("returns a bounded 503 dependency state", async () => {
    vi.mocked(readinessSnapshot).mockResolvedValueOnce(snapshot("degraded"));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      data: { status: "degraded" },
    });
  });
});
