import { expect, it } from "vitest";

import { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import { jmapSetResultSchema } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.schema";

it("never includes provider method-error text in the thrown error", () => {
  const privateRecipient = "private-bcc@example.com";
  const response = {
    methodResponses: [
      [
        "error",
        { description: `Rejected recipient ${privateRecipient}` },
        "submit",
      ],
    ] as const,
    sessionState: "state",
  };
  const client = new StalwartJmapClient({
    authType: "basic",
    baseUrl: "https://mail.example.com",
    secret: "secret",
    username: "user@example.com",
  });

  let thrown: unknown;
  try {
    client.result(
      response,
      "submit",
      "EmailSubmission/set",
      jmapSetResultSchema,
    );
  } catch (error) {
    thrown = error;
  }

  expect(String(thrown)).toContain("JMAP provider rejected the request");
  expect(String(thrown)).not.toContain(privateRecipient);
});
