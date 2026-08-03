import { describe, expect, it, vi } from "vitest";
import type { ZodType } from "zod";

import type { DraftContent, DraftDetail } from "@/domain/mail/draft";
import { id } from "@/domain/shared/brand";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import {
  jmapDraftComposeKeyword,
  jmapDraftContentKeyword,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-fingerprint";
import type { JmapDraftEmail } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft.schema";
import type { ClaimedDraft } from "@/infrastructure/providers/stalwart-jmap/stalwart-saved-draft-claim";
import { sendClaimedStalwartDraft } from "@/infrastructure/providers/stalwart-jmap/stalwart-saved-draft-replacement";
import type { JmapResponse } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";
import { safeStalwartDraftShape } from "./stalwart-draft-safe-shape";

const composeId = id.draft("56d5ae86-39bb-49dd-86cc-c5464b58c1c4");
const providerDraftId = id.providerDraft("provider-draft");
const content: DraftContent = {
  bcc: [],
  body: "Saved content",
  cc: [],
  htmlBody: "<p>Saved content</p>",
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
  updatedAt: "2026-08-03T04:00:00.000Z",
};
const claimKeyword = "$veda-claimed-test";
const claimed: ClaimedDraft = {
  claimKeyword,
  source: {
    context: { accountId: "account", draftsMailboxId: "drafts" },
    record: {
      detail,
      email: {
        ...safeStalwartDraftShape({
          from: [{ email: "member@example.com", name: "Member" }],
          htmlPartId: "html",
          messageId: "saved@example.com",
          to: content.to,
        }),
        from: [{ email: "member@example.com", name: "Member" }],
        inReplyTo: [],
        keywords: {
          $draft: true,
          [claimKeyword]: true,
          [jmapDraftComposeKeyword(composeId)]: true,
          [jmapDraftContentKeyword(content)]: true,
        },
        mailboxIds: { drafts: true },
        messageId: ["saved@example.com"],
        references: [],
        to: content.to,
      } as unknown as JmapDraftEmail,
      state: "claimed-state",
    },
  },
};
const context = {
  accountId: "account",
  draftMailboxId: "drafts",
  identity: { email: "member@example.com", id: "identity", name: "Member" },
  sentMailboxId: "sent",
};
const response = (
  ...methodResponses: JmapResponse["methodResponses"]
): JmapResponse => ({ methodResponses, sessionState: "session" });
const result = (
  value: JmapResponse,
  callId: string,
  method: string,
  schema: ZodType,
) => {
  const match = value.methodResponses.find(
    ([candidate, , candidateCallId]) =>
      candidate === method && candidateCallId === callId,
  );
  if (!match) throw new Error("missing response");
  return schema.parse(match[1]);
};
const incompleteSubmission = (createId: string) =>
  response(
    [
      "Email/set",
      {
        accountId: "account",
        created: { [createId]: { id: "send-copy" } },
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
        newState: "submission-new",
        oldState: "submission-old",
      },
      "submit-saved-draft",
    ],
    [
      "Email/set",
      {
        accountId: "account",
        newState: "sent-state",
        oldState: "unexpected-copy-state",
        updated: { "send-copy": null },
      },
      "submit-saved-draft",
    ],
  );
const clientFor = (sentMembership: boolean) => {
  let reads = 0;
  const request = vi.fn(async (calls: readonly unknown[][]) => {
    const callId = calls[0]?.[2];
    if (callId === "create-send-copy") {
      const create = (calls[0]?.[1] as { create: Record<string, unknown> })
        .create;
      return incompleteSubmission(Object.keys(create)[0]!);
    }
    if (callId === "cleanup-submitted-email") {
      return response([
        "Email/set",
        {
          accountId: "account",
          newState: "clean-state",
          oldState: "dirty-state",
          updated: { "send-copy": null },
        },
        "cleanup-submitted-email",
      ]);
    }
    reads += 1;
    const clean = sentMembership && reads > 1;
    return response([
      "Email/get",
      {
        accountId: "account",
        list: [{
          id: "send-copy",
          keywords: clean
            ? { $seen: true }
            : {
                $draft: true,
                $seen: true,
                [claimKeyword]: true,
                [jmapDraftComposeKeyword(composeId)]: true,
                [jmapDraftContentKeyword(content)]: true,
              },
          mailboxIds: sentMembership
            ? clean ? { sent: true } : { drafts: true, sent: true }
            : { drafts: true },
        }],
        notFound: [],
        state: clean ? "clean-state" : "dirty-state",
      },
      "verify-submitted-email",
    ]);
  });
  return {
    client: { request, result } as unknown as StalwartJmapClient,
    request,
  };
};

describe("Stalwart saved-draft Sent cleanup", () => {
  it("repairs an incomplete implicit update before accepting", async () => {
    const { client, request } = clientFor(true);

    await expect(
      sendClaimedStalwartDraft(client, content, claimed, context),
    ).resolves.toMatchObject({ kind: "accepted", copy: { emailId: "send-copy" } });

    const cleanupCall = request.mock.calls.find(
      ([calls]) => calls[0]?.[2] === "cleanup-submitted-email",
    )?.[0];
    expect(cleanupCall?.[0]?.[1]).toMatchObject({
      update: {
        "send-copy": {
          "keywords/$draft": null,
          [`keywords/${claimKeyword}`]: null,
          [`keywords/${jmapDraftComposeKeyword(composeId)}`]: null,
          [`keywords/${jmapDraftContentKeyword(content)}`]: null,
          "mailboxIds/drafts": null,
          "mailboxIds/sent": true,
        },
      },
    });
  });

  it("does not mutate a copy without verified Sent membership", async () => {
    const { client, request } = clientFor(false);

    await expect(
      sendClaimedStalwartDraft(client, content, claimed, context),
    ).resolves.toMatchObject({ kind: "uncertain", copy: { emailId: "send-copy" } });
    expect(
      request.mock.calls.some(
        ([calls]) => calls[0]?.[2] === "cleanup-submitted-email",
      ),
    ).toBe(false);
  });
});
