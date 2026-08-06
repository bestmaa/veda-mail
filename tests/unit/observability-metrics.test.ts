import { beforeEach, describe, expect, it } from "vitest";

import { id } from "@/domain/shared/brand";
import {
  observeProviderOperation,
  observabilitySnapshot,
  recordHttpResponse,
  renderPrometheusMetrics,
  resetObservabilityMetricsForTests,
} from "@/server/observability/metrics";

beforeEach(resetObservabilityMetricsForTests);

describe("bounded observability metrics", () => {
  it("aggregates provider outcomes without mailbox labels", () => {
    observeProviderOperation(id.provider("stalwart-jmap"), "listMessages", 10, "success");
    observeProviderOperation(id.provider("stalwart-jmap"), "listMessages", 30, "error");
    recordHttpResponse(200);
    recordHttpResponse(503);
    expect(observabilitySnapshot()).toMatchObject({
      httpResponses: [
        { count: 1, statusClass: 2 },
        { count: 1, statusClass: 5 },
      ],
      providers: [
        {
          averageMs: 20,
          count: 2,
          errors: 1,
          maximumMs: 30,
          operation: "listMessages",
          providerId: "stalwart-jmap",
        },
      ],
    });
    const output = renderPrometheusMetrics();
    expect(output).toContain('provider="stalwart-jmap",operation="listMessages"');
    expect(output).not.toMatch(/email|mailbox|connection/iu);
  });
});
