import { describe, expect, it, vi } from "vitest";

import { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import type { StalwartJmapRequestBoundary } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-client-helpers";
import { submitStalwartMessage } from "@/infrastructure/providers/stalwart-jmap/stalwart-send-submission";

const initialResponse = {
  methodResponses: [
    [
      "Email/set",
      {
        accountId: "account",
        created: { draft: { id: "email" } },
        newState: "email-state-2",
        oldState: "email-state-1",
      },
      "create",
    ],
    [
      "EmailSubmission/set",
      {
        accountId: "account",
        created: { submit: { id: "submission" } },
        newState: "submission-state-2",
        oldState: "submission-state-1",
      },
      "submit",
    ],
    [
      "Email/set",
      {
        accountId: "account",
        newState: "email-state-3",
        updated: { email: null },
      },
      "submit",
    ],
  ],
  sessionState: "state",
} as const;

const emailResponse = (clean: boolean) => ({
  methodResponses: [[
    "Email/get",
    {
      accountId: "account",
      list: [{
        id: "email",
        keywords: clean ? { $seen: true } : { $draft: true, $seen: true },
        mailboxIds: clean ? { sent: true } : { drafts: true, sent: true },
      }],
      notFound: [],
      state: clean ? "email-state-4" : "email-state-3",
    },
    "verify-submitted-email",
  ]],
  sessionState: "state",
});

describe("Stalwart submission cleanup integration", () => {
  it("repairs verified Sent state after an incomplete implicit update", async () => {
    const requests: unknown[] = [];
    let requestIndex = 0;
    const client = {
      request: vi.fn(
        async (
          calls: unknown,
          _using: unknown,
          _signal: unknown,
          boundary?: StalwartJmapRequestBoundary,
        ) => {
          requests.push(calls);
          if (boundary) boundary.issued = true;
          requestIndex += 1;
          if (requestIndex === 1) return initialResponse;
          if (requestIndex === 2) return emailResponse(false);
          if (requestIndex === 4) return emailResponse(true);
          return { methodResponses: [], sessionState: "state" };
        },
      ),
      result: StalwartJmapClient.prototype.result,
    } as unknown as StalwartJmapClient;

    await expect(
      submitStalwartMessage(
        client,
        [],
        "draft",
        "account",
        { draftMailboxId: "drafts", sentMailboxId: "sent" },
      ),
    ).resolves.toMatchObject({ deliveryStatus: "accepted", id: "email" });
    expect(requests).toHaveLength(4);
  });

  it("does not inspect or mutate state without strict primary evidence", async () => {
    const request = vi.fn(async (
      _calls: unknown,
      _using: unknown,
      _signal: unknown,
      boundary?: StalwartJmapRequestBoundary,
    ) => {
      if (boundary) boundary.issued = true;
      return {
        ...initialResponse,
        methodResponses: initialResponse.methodResponses.map((method, index) =>
          index === 0
            ? [method[0], { ...method[1], accountId: "wrong-account" }, method[2]]
            : method,
        ),
      };
    });
    const client = {
      request,
      result: StalwartJmapClient.prototype.result,
    } as unknown as StalwartJmapClient;

    await expect(
      submitStalwartMessage(
        client,
        [],
        "draft",
        "account",
        { draftMailboxId: "drafts", sentMailboxId: "sent" },
      ),
    ).resolves.toMatchObject({ deliveryStatus: "uncertain" });
    expect(request).toHaveBeenCalledTimes(1);
  });
});
