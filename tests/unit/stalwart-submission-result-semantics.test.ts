import { describe, expect, it } from "vitest";

import { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import type { StalwartJmapRequestBoundary } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-client-helpers";
import { submitStalwartMessage } from "@/infrastructure/providers/stalwart-jmap/stalwart-send-submission";
import type { JmapMethodResponse } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

const createdEmail: JmapMethodResponse = [
  "Email/set",
  { created: { draft: { id: "email" } } },
  "create",
];
const createdSubmission: JmapMethodResponse = [
  "EmailSubmission/set",
  { created: { submit: { id: "submission" } } },
  "submit",
];

const clientWithResponses = (
  methodResponses: readonly JmapMethodResponse[],
): StalwartJmapClient =>
  ({
    request: async (
      _calls: unknown,
      _using: unknown,
      _signal: unknown,
      boundary: StalwartJmapRequestBoundary,
    ) => {
      boundary.issued = true;
      return { methodResponses, sessionState: "state" };
    },
    result: StalwartJmapClient.prototype.result,
  }) as unknown as StalwartJmapClient;

const failureFrom = async (pending: Promise<unknown>): Promise<unknown> => {
  try {
    await pending;
    return null;
  } catch (error) {
    return error;
  }
};

const ambiguousCreateCases: readonly {
  readonly label: string;
  readonly responses: readonly JmapMethodResponse[];
}[] = [
  { label: "missing", responses: [] },
  {
    label: "malformed",
    responses: [["Email/set", { created: "invalid" }, "create"]],
  },
  {
    label: "contradictory",
    responses: [
      [
        "Email/set",
        {
          created: { draft: { id: "email" } },
          notCreated: { draft: { type: "forbidden" } },
        },
        "create",
      ],
    ],
  },
];

describe("Stalwart submission result semantics", () => {
  it.each(ambiguousCreateCases)(
    "keeps submission notCreated retryable when create is $label",
    async ({ responses }) => {
      const privateRecipient = "private-bcc@example.com";
      const failure = await failureFrom(
        submitStalwartMessage(
          clientWithResponses([
            ...responses,
            [
              "EmailSubmission/set",
              {
                notCreated: {
                  submit: {
                    description: `Rejected ${privateRecipient}`,
                    type: "forbidden",
                  },
                },
              },
              "submit",
            ],
          ]),
          [],
          "draft",
        ),
      );

      expect(failure).toMatchObject({
        message: "Stalwart did not create the outgoing message.",
      });
      expect(failure).not.toHaveProperty("cause");
      expect(String(failure)).not.toContain(privateRecipient);
    },
  );

  it("keeps an ordinary submission method error retryable and redacted", async () => {
    const privateRecipient = "private-bcc@example.com";
    const failure = await failureFrom(
      submitStalwartMessage(
        clientWithResponses([
          [
            "error",
            {
              description: `Rejected ${privateRecipient}`,
              type: "forbidden",
            },
            "submit",
          ],
        ]),
        [],
        "draft",
      ),
    );

    expect(failure).toMatchObject({
      message: "Stalwart did not create the outgoing message.",
    });
    expect(failure).not.toHaveProperty("cause");
    expect(String(failure)).not.toContain(privateRecipient);
  });

  it.each([
    ["serverPartialFail", { type: "serverPartialFail" }],
    ["malformed", { description: "private provider detail" }],
    ["empty-type", { type: "" }],
  ])("returns uncertain for a %s submission method error", async (_, error) => {
    const receipt = await submitStalwartMessage(
      clientWithResponses([["error", error, "submit"]]),
      [],
      "draft",
    );

    expect(receipt).toMatchObject({
      deliveryStatus: "uncertain",
      rejectedRecipients: [],
    });
    expect(JSON.stringify(receipt)).not.toContain("private provider detail");
  });

  it.each(["primary-first", "error-first"])(
    "returns uncertain for duplicate submit outcomes in %s order",
    async (order) => {
      const methodError: JmapMethodResponse = [
        "error",
        { type: "forbidden" },
        "submit",
      ];
      const duplicate =
        order === "primary-first"
          ? [createdSubmission, methodError]
          : [methodError, createdSubmission];
      const receipt = await submitStalwartMessage(
        clientWithResponses([createdEmail, ...duplicate]),
        [],
        "draft",
      );

      expect(receipt.deliveryStatus).toBe("uncertain");
      expect(receipt.rejectedRecipients).toEqual([]);
    },
  );

  it("keeps generic result parsing strict for an unexpected same-call response", async () => {
    const receipt = await submitStalwartMessage(
      clientWithResponses([
        createdEmail,
        ["Identity/get", { list: [] }, "create"],
        createdSubmission,
      ]),
      [],
      "draft",
    );

    expect(receipt.deliveryStatus).toBe("uncertain");
    expect(receipt.rejectedRecipients).toEqual([]);
  });

  it("allows a different-method implicit response with the submit call id", async () => {
    await expect(
      submitStalwartMessage(
        clientWithResponses([
          createdEmail,
          createdSubmission,
          ["Email/set", { updated: { email: null } }, "submit"],
        ]),
        [],
        "draft",
      ),
    ).resolves.toMatchObject({
      deliveryStatus: "accepted",
      id: "email",
      rejectedRecipients: [],
    });
  });
});
