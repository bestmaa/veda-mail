import { expect, it } from "vitest";

import { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import { submitStalwartMessage } from "@/infrastructure/providers/stalwart-jmap/stalwart-send-submission";
import type { JmapResponse } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

it("accepts Stalwart's created submission when oldState is omitted", async () => {
  const response: JmapResponse = {
    methodResponses: [
      ["Email/set", {
        accountId: "account",
        created: { draft: { id: "email" } },
        newState: "email-state-2",
        oldState: "email-state-1",
      }, "create"],
      ["EmailSubmission/set", {
        accountId: "account",
        created: { submit: { id: "submission" } },
        newState: "submission-state-2",
      }, "submit"],
      ["Email/set", {
        accountId: "account",
        newState: "email-state-3",
        oldState: "email-state-2",
        updated: { email: null },
      }, "submit"],
    ],
    sessionState: "state",
  };
  const client = {
    request: async () => response,
    result: StalwartJmapClient.prototype.result,
  } as unknown as StalwartJmapClient;

  await expect(
    submitStalwartMessage(client, [], "draft", "account"),
  ).resolves.toMatchObject({
    deliveryStatus: "accepted",
    id: "email",
    rejectedRecipients: [],
  });
});
