import { describe, expect, it, vi } from "vitest";

import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import type { StalwartJmapRequestBoundary } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-client-helpers";
import { submitStalwartMessage } from "@/infrastructure/providers/stalwart-jmap/stalwart-send-submission";

const response = { methodResponses: [], sessionState: "state" };

const clientWith = (input: {
  readonly request?: (
    boundary: StalwartJmapRequestBoundary,
  ) => Promise<typeof response>;
  readonly result?: (callId: string) => unknown;
}): StalwartJmapClient =>
  ({
    request: vi.fn(
      async (
        _calls: unknown,
        _using: unknown,
        _signal: unknown,
        boundary: StalwartJmapRequestBoundary,
      ) => {
        if (input.request) return input.request(boundary);
        boundary.issued = true;
        return response;
      },
    ),
    result:
      input.result === undefined
        ? vi.fn((_response: unknown, callId: string) =>
            callId === "create"
              ? { created: { draft: { id: "email" } } }
              : { created: { submit: { id: "submission" } } },
          )
        : vi.fn((_response: unknown, callId: string) =>
            input.result?.(callId),
          ),
  }) as unknown as StalwartJmapClient;

describe("Stalwart terminal submission boundary", () => {
  it("rethrows failures before the final request is issued", async () => {
    const preflightFailure = new Error("JMAP session discovery failed.");
    await expect(
      submitStalwartMessage(
        clientWith({
          request: async () => {
            throw preflightFailure;
          },
        }),
        [],
        "draft",
      ),
    ).rejects.toBe(preflightFailure);
  });

  it("returns uncertain when the issued submission request loses transport", async () => {
    const providerSecret = "recipient-secret@example.com";
    const receipt = await submitStalwartMessage(
      clientWith({
        request: async (boundary) => {
          boundary.issued = true;
          throw Object.assign(new Error(providerSecret), {
            code: "ETIMEDOUT",
          });
        },
      }),
      [],
      "draft",
    );

    expect(receipt).toMatchObject({
      deliveryStatus: "uncertain",
      rejectedRecipients: [],
    });
    expect(JSON.stringify(receipt)).not.toContain(providerSecret);
  });

  it.each(["create", "submit"])(
    "returns uncertain for malformed %s results after submission",
    async (failedCall) => {
      const receipt = await submitStalwartMessage(
        clientWith({
          result: (callId) => {
            if (callId === failedCall) {
              throw new Error("private malformed provider response");
            }
            return callId === "create"
              ? { created: { draft: { id: "email" } } }
              : { created: { submit: { id: "submission" } } };
          },
        }),
        [],
        "draft",
      );

      expect(receipt.deliveryStatus).toBe("uncertain");
      expect(receipt.rejectedRecipients).toEqual([]);
    },
  );

  it.each(["create", "submit"])(
    "returns uncertain for missing %s results after submission",
    async (failedCall) => {
      const receipt = await submitStalwartMessage(
        clientWith({
          result: (callId) =>
            callId === failedCall
              ? {}
              : callId === "create"
                ? { created: { draft: { id: "email" } } }
                : { created: { submit: { id: "submission" } } },
        }),
        [],
        "draft",
      );

      expect(receipt).toMatchObject({
        deliveryStatus: "uncertain",
        rejectedRecipients: [],
      });
    },
  );

  it.each(["create", "submit"])(
    "returns uncertain for contradictory %s created and notCreated results",
    async (failedCall) => {
      const receipt = await submitStalwartMessage(
        clientWith({
          result: (callId) => {
            const key = callId === "create" ? "draft" : "submit";
            if (callId === failedCall) {
              return {
                created: { [key]: { id: `${key}-id` } },
                notCreated: { [key]: { type: "forbidden" } },
              };
            }
            return callId === "create"
              ? { created: { draft: { id: "email" } } }
              : { created: { submit: { id: "submission" } } };
          },
        }),
        [],
        "draft",
      );

      expect(receipt).toMatchObject({
        deliveryStatus: "uncertain",
        rejectedRecipients: [],
      });
    },
  );

  it("keeps an explicit valid submission notCreated result retryable", async () => {
    const client = clientWith({
      result: (callId) =>
        callId === "create"
          ? { created: { draft: { id: "email" } } }
          : { notCreated: { submit: { type: "forbidden" } } },
    });

    await expect(
      submitStalwartMessage(client, [], "draft"),
    ).rejects.toThrow("did not create");
  });

  it("keeps consistent create and submission notCreated results retryable", async () => {
    const client = clientWith({
      result: (callId) => {
        const key = callId === "create" ? "draft" : "submit";
        return { notCreated: { [key]: { type: "forbidden" } } };
      },
    });

    await expect(
      submitStalwartMessage(client, [], "draft"),
    ).rejects.toThrow("did not create");
  });

  it("returns uncertain for create notCreated plus submission created", async () => {
    const receipt = await submitStalwartMessage(
      clientWith({
        result: (callId) =>
          callId === "create"
            ? { notCreated: { draft: { type: "forbidden" } } }
            : { created: { submit: { id: "submission" } } },
      }),
      [],
      "draft",
    );

    expect(receipt).toMatchObject({
      deliveryStatus: "uncertain",
      rejectedRecipients: [],
    });
  });

  it("returns accepted only for unambiguous created results", async () => {
    await expect(
      submitStalwartMessage(clientWith({}), [], "draft"),
    ).resolves.toMatchObject({
      deliveryStatus: "accepted",
      id: "email",
      rejectedRecipients: [],
    });
  });
});
