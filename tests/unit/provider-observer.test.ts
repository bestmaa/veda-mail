import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MailGateway } from "@/application/ports/mail-provider.port";
import { id } from "@/domain/shared/brand";
import {
  observabilitySnapshot,
  resetObservabilityMetricsForTests,
} from "@/server/observability/metrics";
import { observeMailGateway } from "@/server/observability/provider-observer";

beforeEach(resetObservabilityMetricsForTests);
afterEach(() => vi.restoreAllMocks());

describe("provider operation observer", () => {
  it("records success and redacted failure latency", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const source = {
      getMaxAttachmentBytes: vi.fn().mockResolvedValueOnce(42),
      getAccount: vi.fn().mockRejectedValueOnce(new Error("mailbox secret")),
    } as unknown as MailGateway;
    const gateway = observeMailGateway(source, id.provider("stalwart-jmap"));
    await expect(gateway.getMaxAttachmentBytes()).resolves.toBe(42);
    await expect(gateway.getAccount()).rejects.toThrow("mailbox secret");
    expect(observabilitySnapshot().providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          count: 1,
          errors: 1,
          operation: "getAccount",
        }),
        expect.objectContaining({
          count: 1,
          errors: 0,
          operation: "getMaxAttachmentBytes",
        }),
      ]),
    );
    expect(String(vi.mocked(console.warn).mock.calls[0]?.[0])).not.toContain(
      "mailbox secret",
    );
  });
});
