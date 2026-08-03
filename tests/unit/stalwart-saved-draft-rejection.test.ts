import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ZodType } from "zod";

const workflow = vi.hoisted(() => ({
  assertComposeMembers: vi.fn(),
  claim: vi.fn(),
  destroy: vi.fn(),
  loadClaimed: vi.fn(),
  release: vi.fn(),
}));

vi.mock(
  "@/infrastructure/providers/stalwart-jmap/stalwart-draft-compose-members",
  () => ({
    assertStalwartDraftComposeMembers: workflow.assertComposeMembers,
  }),
);
vi.mock(
  "@/infrastructure/providers/stalwart-jmap/stalwart-saved-draft-claim",
  () => ({
    destroyClaimedStalwartDraft: workflow.destroy,
    releaseClaimedStalwartDraft: workflow.release,
  }),
);
vi.mock(
  "@/infrastructure/providers/stalwart-jmap/stalwart-saved-draft-claim-acquire",
  () => ({
    claimStalwartSavedDraft: workflow.claim,
    loadClaimedStalwartDraft: workflow.loadClaimed,
  }),
);

import type { DraftContent, DraftDetail } from "@/domain/mail/draft";
import { id } from "@/domain/shared/brand";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import {
  jmapDraftComposeKeyword,
  jmapDraftContentKeyword,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-fingerprint";
import type { JmapDraftEmail } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft.schema";
import type { StalwartDraftSendSource } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft.store";
import { submitStalwartSavedDraft } from "@/infrastructure/providers/stalwart-jmap/stalwart-saved-draft-send";
import type { JmapResponse } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";
import { safeStalwartDraftShape } from "./stalwart-draft-safe-shape";

const composeId = id.draft("7555eb62-6259-41a8-90cc-0ea3e92e6079");
const providerDraftId = id.providerDraft("provider-draft");
const claimKeyword = "veda-send-claim-test";
const content: DraftContent = {
  bcc: [],
  body: "Saved content",
  cc: [],
  subject: "Saved subject",
  to: [{ email: "reader@example.com", name: null }],
};
const detail: DraftDetail = {
  composeId,
  content,
  hasAttachments: false,
  hasTruncatedContent: false,
  hasUncertainSubmission: false,
  id: providerDraftId,
  revision: "revision-provider-draft",
  updatedAt: "2026-07-31T10:00:00.000Z",
};
const source = (state = "source-state"): StalwartDraftSendSource => ({
  context: { accountId: "account", draftsMailboxId: "drafts" },
  record: {
    detail,
    email: {
      ...safeStalwartDraftShape({
        from: [{ email: "member@example.com", name: "Member" }],
        messageId: "saved@example.com",
        to: content.to,
      }),
      bcc: [],
      cc: [],
      from: [{ email: "member@example.com", name: "Member" }],
      inReplyTo: [],
      keywords: {
        $draft: true,
        [jmapDraftComposeKeyword(composeId)]: true,
        [jmapDraftContentKeyword(content)]: true,
        ...(state === "claimed-state" ? { [claimKeyword]: true } : {}),
      },
      mailboxIds: { drafts: true },
      messageId: ["saved@example.com"],
      references: [],
      to: content.to,
    } as unknown as JmapDraftEmail,
    state,
  },
});
const context = {
  accountId: "account",
  draftMailboxId: "drafts",
  identity: { email: "member@example.com", id: "identity", name: "Member" },
  sentMailboxId: "sent",
};
const nullSetPartitions = {
  destroyed: null,
  notCreated: null,
  notDestroyed: null,
  notUpdated: null,
};
const clientFor = (batch: (createId: string) => JmapResponse) => {
  const request = vi.fn(async (calls: readonly unknown[][]) => {
    const create = (calls[0]?.[1] as { create: Record<string, unknown> })
      .create;
    return batch(Object.keys(create)[0]!);
  });
  const result = vi.fn(
    (value: JmapResponse, callId: string, method: string, schema: ZodType) => {
      const match = value.methodResponses.find(
        ([candidate, , candidateCallId]) =>
          candidate === method && candidateCallId === callId,
      );
      if (!match) throw new Error("missing response");
      return schema.parse(match[1]);
    },
  );
  return { client: { request, result } as unknown as StalwartJmapClient };
};

beforeEach(() => {
  vi.resetAllMocks();
  const claimed = source("claimed-state");
  workflow.claim.mockResolvedValue({
    kind: "claimed",
    value: { claimKeyword, source: claimed },
  });
  workflow.assertComposeMembers.mockResolvedValue(undefined);
  workflow.destroy.mockResolvedValue(true);
  workflow.release.mockResolvedValue(true);
});

describe("Stalwart saved draft rejection semantics", () => {
  it("keeps a contradictory create rejection uncertain without release", async () => {
    const { client } = clientFor((createId) => ({
      methodResponses: [
        [
          "Email/set",
          {
            accountId: "account",
            newState: "wrong-state",
            notCreated: { [createId]: { type: "forbidden" } },
            oldState: "wrong-state",
          },
          "create-send-copy",
        ],
      ],
      sessionState: "session",
    }));
    await expect(
      submitStalwartSavedDraft(client, content, source(), context),
    ).resolves.toMatchObject({ deliveryStatus: "uncertain" });
    expect(workflow.release).not.toHaveBeenCalled();
    expect(workflow.destroy).not.toHaveBeenCalled();
  });

  it("keeps a non-advancing send-copy state uncertain", async () => {
    const { client } = clientFor((createId) => ({
      methodResponses: [
        [
          "Email/set",
          {
            accountId: "account",
            created: { [createId]: { id: "send-copy" } },
            newState: "claimed-state",
            oldState: "claimed-state",
          },
          "create-send-copy",
        ],
      ],
      sessionState: "session",
    }));
    await expect(
      submitStalwartSavedDraft(client, content, source(), context),
    ).resolves.toMatchObject({ deliveryStatus: "uncertain" });
    expect(workflow.release).not.toHaveBeenCalled();
  });

  it.each([
    ["copy-state", "accepted"],
    ["sent-state", "accepted"],
  ] as const)(
    "preserves authoritative submission for an implicit %s update",
    async (newState, status) => {
      const { client } = clientFor((createId) => ({
        methodResponses: [
          [
            "Email/set",
            {
              accountId: "account",
              created: { [createId]: { id: "send-copy" } },
              ...nullSetPartitions,
              newState: "copy-state",
              oldState: "claimed-state",
            },
            "create-send-copy",
          ],
          [
            "EmailSubmission/set",
            {
              accountId: "account",
              created: { submit: { id: "submission" } },
              ...nullSetPartitions,
              newState: "submission-state-2",
              oldState: "submission-state-1",
            },
            "submit-saved-draft",
          ],
          [
            "Email/set",
            {
              accountId: "account",
              created: null,
              ...nullSetPartitions,
              newState,
              oldState: "copy-state",
              updated: { "send-copy": null },
            },
            "submit-saved-draft",
          ],
        ],
        sessionState: "session",
      }));
      await expect(
        submitStalwartSavedDraft(client, content, source(), context),
      ).resolves.toMatchObject({
        deliveryStatus: status,
        id: "send-copy",
      });
      expect(workflow.destroy).toHaveBeenCalledTimes(
        status === "accepted" ? 1 : 0,
      );
    },
  );
});
