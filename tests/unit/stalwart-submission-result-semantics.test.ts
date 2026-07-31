import { describe, expect, it } from "vitest";
import { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import type { StalwartJmapRequestBoundary } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-client-helpers";
import { submitStalwartMessage } from "@/infrastructure/providers/stalwart-jmap/stalwart-send-submission";
import type {
  JmapMethodCall,
  JmapMethodResponse,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

const createdEmail: JmapMethodResponse = [
  "Email/set",
  {
    accountId: "account",
    created: { draft: { id: "email" } },
    newState: "email-state-2",
    oldState: "email-state-1",
  },
  "create",
];
const createdSubmission: JmapMethodResponse = [
  "EmailSubmission/set",
  {
    accountId: "account",
    created: { submit: { id: "submission" } },
    newState: "submission-state-2",
    oldState: "submission-state-1",
  },
  "submit",
];

const clientWithResponses = (
  methodResponses: readonly JmapMethodResponse[],
): StalwartJmapClient =>
  ({
    request: async (
      calls: unknown,
      _using: unknown,
      _signal: unknown,
      boundary: StalwartJmapRequestBoundary,
    ) => {
      boundary.issued = true;
      if (
        (calls as readonly JmapMethodCall[])[0]?.[2] ===
        "cleanup-rejected-submission"
      ) {
        return {
          methodResponses: [
            [
              "Email/set",
              {
                accountId: "account",
                destroyed: ["email"],
                newState: "email-state-3",
                oldState: "email-state-2",
              },
              "cleanup-rejected-submission",
            ],
          ] as const,
          sessionState: "state",
        };
      }
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
          "account",
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
        "account",
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
      "account",
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
        "account",
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
      "account",
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
          [
            "Email/set",
            {
              accountId: "account",
              newState: "email-state-3",
              oldState: "email-state-2",
              updated: { email: null },
            },
            "submit",
          ],
        ]),
        [],
        "draft",
        "account",
      ),
    ).resolves.toMatchObject({
      deliveryStatus: "accepted",
      id: "email",
      rejectedRecipients: [],
    });
  });
});
