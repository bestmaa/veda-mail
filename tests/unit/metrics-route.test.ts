import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GET } from "@/app/api/metrics/route";
import {
  recordHttpResponse,
  resetObservabilityMetricsForTests,
} from "@/server/observability/metrics";

const previous = process.env["VEDA_MAIL_METRICS_TOKEN"];
beforeEach(resetObservabilityMetricsForTests);
afterEach(() => {
  if (previous === undefined) delete process.env["VEDA_MAIL_METRICS_TOKEN"];
  else process.env["VEDA_MAIL_METRICS_TOKEN"] = previous;
});

describe("GET /api/metrics", () => {
  it("stays hidden until a token is configured", async () => {
    delete process.env["VEDA_MAIL_METRICS_TOKEN"];
    const response = GET(new Request("https://mail.example/api/metrics"));
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("serves Prometheus text only to the exact bearer", async () => {
    process.env["VEDA_MAIL_METRICS_TOKEN"] = "metrics-token-at-least-24-chars";
    recordHttpResponse(503);
    const unauthorized = GET(
      new Request("https://mail.example/api/metrics", {
        headers: { authorization: "Bearer incorrect-token-12345678" },
      }),
    );
    expect(unauthorized.status).toBe(401);
    const response = GET(
      new Request("https://mail.example/api/metrics", {
        headers: {
          authorization: "Bearer metrics-token-at-least-24-chars",
        },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("version=0.0.4");
    expect(await response.text()).toContain("veda_mail_http_responses_total");
  });
});
