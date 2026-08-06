import { afterEach, describe, expect, it } from "vitest";

import { metricsAccess } from "@/server/observability/metrics-auth";

const previous = process.env["VEDA_MAIL_METRICS_TOKEN"];
afterEach(() => {
  if (previous === undefined) delete process.env["VEDA_MAIL_METRICS_TOKEN"];
  else process.env["VEDA_MAIL_METRICS_TOKEN"] = previous;
});

describe("metrics bearer access", () => {
  it("is hidden when metrics are not configured", () => {
    delete process.env["VEDA_MAIL_METRICS_TOKEN"];
    expect(metricsAccess(new Request("https://mail.example/api/metrics"))).toBe(
      "disabled",
    );
  });

  it("compares a bounded bearer token exactly", () => {
    process.env["VEDA_MAIL_METRICS_TOKEN"] = "metrics-token-at-least-24-chars";
    const authorized = new Request("https://mail.example/api/metrics", {
      headers: {
        authorization: "Bearer metrics-token-at-least-24-chars",
      },
    });
    expect(metricsAccess(authorized)).toBe("authorized");
    expect(
      metricsAccess(
        new Request("https://mail.example/api/metrics", {
          headers: { authorization: "Bearer wrong-token-value-123456" },
        }),
      ),
    ).toBe("unauthorized");
  });
});
