import { describe, expect, it, vi } from "vitest";

import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import type { StalwartJmapRequestBoundary } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-client-helpers";
import { submitStalwartMessage } from "@/infrastructure/providers/stalwart-jmap/stalwart-send-submission";
import type { JmapResponse } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

const clientWithRequest = (
  request: (boundary: StalwartJmapRequestBoundary) => Promise<JmapResponse>,
): StalwartJmapClient =>
  ({
    request: vi.fn(
      async (
        _calls: unknown,
        _using: unknown,
        _signal: unknown,
        boundary: StalwartJmapRequestBoundary,
      ) => request(boundary),
    ),
  }) as unknown as StalwartJmapClient;

describe("Stalwart submission transport boundary", () => {
  it("rethrows failures before the final request is issued", async () => {
    const preflightFailure = new Error("JMAP session discovery failed.");
    await expect(
      submitStalwartMessage(
        clientWithRequest(async () => {
          throw preflightFailure;
        }),
        [],
        "draft",
        "account",
      ),
    ).rejects.toBe(preflightFailure);
  });

  it("returns uncertain when the issued submission request loses transport", async () => {
    const providerSecret = "recipient-secret@example.com";
    const receipt = await submitStalwartMessage(
      clientWithRequest(async (boundary) => {
        boundary.issued = true;
        throw Object.assign(new Error(providerSecret), { code: "ETIMEDOUT" });
      }),
      [],
      "draft",
      "account",
    );

    expect(receipt).toMatchObject({
      deliveryStatus: "uncertain",
      rejectedRecipients: [],
    });
    expect(JSON.stringify(receipt)).not.toContain(providerSecret);
  });
});
