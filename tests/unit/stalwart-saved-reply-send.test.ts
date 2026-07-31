import { expect, it, vi } from "vitest";
import type { ZodType } from "zod";

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

it("directly submits a reopened reply without exposing its provider source id", async () => {
  const composeId = id.draft("064407b2-f174-48e0-8e71-b6060d728a8c");
  const providerDraftId = id.providerDraft("reply-draft");
  const original: DraftContent = {
    bcc: [],
    body: "Reply body",
    cc: [],
    inReplyTo: id.message("private-provider-source-id"),
    subject: "Re: Subject",
    to: [{ email: "reader@example.com", name: null }],
  };
  const reopened: DraftContent = {
    bcc: original.bcc,
    body: original.body,
    cc: original.cc,
    subject: original.subject,
    to: original.to,
  };
  const detail: DraftDetail = {
    composeId,
    content: reopened,
    hasAttachments: false,
    hasTruncatedContent: false,
    hasUncertainSubmission: false,
    id: providerDraftId,
    revision: "revision",
    updatedAt: "2026-07-31T10:00:00.000Z",
  };
  const source: StalwartDraftSendSource = {
    context: { accountId: "account", draftsMailboxId: "drafts" },
    record: {
      detail,
      email: {
        ...safeStalwartDraftShape({
          from: [{ email: "member@example.com", name: "Member" }],
          messageId: "saved-reply@example.com",
          to: original.to,
        }),
        bcc: original.bcc,
        cc: original.cc,
        from: [{ email: "member@example.com", name: "Member" }],
        headers: [
          { name: "From", value: "member@example.com" },
          { name: "Message-ID", value: "saved-reply@example.com" },
          { name: "Content-Type", value: "text/plain; charset=utf-8" },
          { name: "In-Reply-To", value: "reply-rfc-message-id@example.com" },
          { name: "References", value: "reply-rfc-message-id@example.com" },
          { name: "To", value: "reader@example.com" },
        ],
        inReplyTo: ["reply-rfc-message-id@example.com"],
        keywords: {
          $draft: true,
          [jmapDraftComposeKeyword(composeId)]: true,
          [jmapDraftContentKeyword(original)]: true,
        },
        mailboxIds: { drafts: true },
        messageId: ["saved-reply@example.com"],
        references: ["reply-rfc-message-id@example.com"],
        to: original.to,
      } as unknown as JmapDraftEmail,
      state: "ignored-account-state",
    },
  };
  const response = (...methods: JmapResponse["methodResponses"]): JmapResponse => ({
    methodResponses: methods,
    sessionState: "session",
  });
  const request = vi.fn(async (calls: readonly unknown[][]) => {
    const callId = calls[0]?.[2];
    if (callId === "claim-saved-draft") {
      return response([
        "Email/set",
        {
          accountId: "account",
          newState: "claimed",
          oldState: "ignored-account-state",
          updated: { [providerDraftId]: null },
        },
        "claim-saved-draft",
      ]);
    }
    if (callId === "draft-members-query") {
      return response([
        "Email/query",
        {
          accountId: "account",
          ids: [providerDraftId],
          position: 0,
          queryState: "query-state",
          total: 1,
        },
        "draft-members-query",
      ]);
    }
    if (callId === "create-send-copy") {
      const created = (calls[0]?.[1] as { create: Record<string, unknown> }).create;
      const createId = Object.keys(created)[0]!;
      return response(
        [
          "Email/set",
          {
            accountId: "account",
            created: { [createId]: { id: "sent-reply" } },
            newState: "copied",
            oldState: "claimed",
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
            newState: "sent",
            oldState: "copied",
            updated: { "sent-reply": null },
          },
          "submit-saved-draft",
        ],
      );
    }
    return response([
      "Email/set",
      {
        accountId: "account",
        destroyed: [providerDraftId],
        newState: "clean",
        oldState: "claimed",
      },
      "destroy-claimed-draft",
    ]);
  });
  const result = <T>(
    value: JmapResponse,
    callId: string,
    method: string,
    schema: ZodType<T>,
  ): T => {
    const match = value.methodResponses.find(
      ([candidate, , id_]) => candidate === method && id_ === callId,
    );
    return schema.parse(match?.[1]);
  };
  const client = { request, result } as unknown as StalwartJmapClient;

  await expect(
    submitStalwartSavedDraft(client, reopened, source, {
      accountId: "account",
      draftMailboxId: "drafts",
      identity: { email: "member@example.com", id: "identity" },
      sentMailboxId: "sent",
    }),
  ).resolves.toMatchObject({ deliveryStatus: "accepted" });
  expect(JSON.stringify(request.mock.calls)).not.toContain(
    "private-provider-source-id",
  );
});
