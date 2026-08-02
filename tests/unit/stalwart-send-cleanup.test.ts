import { describe, expect, it, vi } from "vitest";

import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import { verifyAndRepairStalwartSentState } from "@/infrastructure/providers/stalwart-jmap/stalwart-send-cleanup";
import type {
  JmapMethodCall,
  JmapResponse,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

const context = { draftMailboxId: "drafts", sentMailboxId: "sent" };

const snapshot = (
  state: string,
  mailboxIds: Readonly<Record<string, boolean>>,
  keywords: Readonly<Record<string, boolean>>,
): JmapResponse => ({
  methodResponses: [
    [
      "Email/get",
      {
        accountId: "account",
        list: [{ id: "email", keywords, mailboxIds }],
        notFound: [],
        state,
      },
      "verify-submitted-email",
    ],
  ],
  sessionState: "session",
});

const clientWith = (
  snapshots: readonly JmapResponse[],
  update?: (calls: readonly JmapMethodCall[]) => Promise<JmapResponse>,
) => {
  const pending = [...snapshots];
  const requests: (readonly JmapMethodCall[])[] = [];
  const client = {
    request: vi.fn(async (calls: readonly JmapMethodCall[]) => {
      requests.push(calls);
      if (calls[0]?.[2] === "cleanup-submitted-email") {
        return update?.(calls) ?? {
          methodResponses: [],
          sessionState: "session",
        };
      }
      const next = pending.shift();
      if (!next) throw new Error("Missing test snapshot.");
      return next;
    }),
    result: (
      response: JmapResponse,
      callId: string,
      expectedMethod: string,
      schema: { parse: (value: unknown) => unknown },
    ) => {
      const method = response.methodResponses.find(
        ([name, , id]) => name === expectedMethod && id === callId,
      );
      if (!method) throw new Error("Missing result.");
      return schema.parse(method[1]);
    },
  } as unknown as StalwartJmapClient;
  return { client, requests };
};

describe("Stalwart sent-state repair", () => {
  it("accepts an independently verified clean Sent message", async () => {
    const { client, requests } = clientWith([
      snapshot("state-1", { sent: true }, { $seen: true }),
    ]);

    await expect(
      verifyAndRepairStalwartSentState(client, "account", "email", context),
    ).resolves.toBe(true);
    expect(requests).toHaveLength(1);
  });

  it("removes the Drafts membership only after Sent membership is verified", async () => {
    const { client, requests } = clientWith([
      snapshot(
        "state-1",
        { drafts: true, sent: true },
        { $draft: true, $seen: true },
      ),
      snapshot("state-2", { sent: true }, { $seen: true }),
    ]);

    await expect(
      verifyAndRepairStalwartSentState(client, "account", "email", context),
    ).resolves.toBe(true);
    expect(requests[1]?.[0]?.[1]).toEqual({
      accountId: "account",
      ifInState: "state-1",
      update: {
        email: {
          "keywords/$draft": null,
          "keywords/$seen": true,
          "mailboxIds/drafts": null,
          "mailboxIds/sent": true,
        },
      },
    });
  });

  it("never mutates a message without verified Sent membership", async () => {
    const { client, requests } = clientWith([
      snapshot("state-1", { drafts: true }, { $draft: true }),
    ]);

    await expect(
      verifyAndRepairStalwartSentState(client, "account", "email", context),
    ).resolves.toBe(false);
    expect(requests).toHaveLength(1);
  });

  it("re-reads after an ambiguous cleanup transport failure", async () => {
    const { client, requests } = clientWith(
      [
        snapshot(
          "state-1",
          { drafts: true, sent: true },
          { $draft: true },
        ),
        snapshot("state-2", { sent: true }, { $seen: true }),
      ],
      async () => {
        throw new Error("transport lost after update");
      },
    );

    await expect(
      verifyAndRepairStalwartSentState(client, "account", "email", context),
    ).resolves.toBe(true);
    expect(requests).toHaveLength(3);
  });

  it("remains uncertain when the provider never confirms cleanup", async () => {
    const dirty = snapshot(
      "state-1",
      { drafts: true, sent: true },
      { $draft: true },
    );
    const { client, requests } = clientWith([dirty, dirty, dirty]);

    await expect(
      verifyAndRepairStalwartSentState(client, "account", "email", context),
    ).resolves.toBe(false);
    expect(requests).toHaveLength(5);
  });
});
