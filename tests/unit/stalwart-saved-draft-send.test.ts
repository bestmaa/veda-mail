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
import type { StalwartDraftSendSource } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft.store";
import { submitStalwartSavedDraft } from "@/infrastructure/providers/stalwart-jmap/stalwart-saved-draft-send";
import type { JmapResponse } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";
import { safeStalwartDraftShape } from "./stalwart-draft-safe-shape";
const composeId = id.draft("ca577bed-c011-4422-886b-86acaaf11a37");
const providerDraftId = id.providerDraft("provider-draft");
const content: DraftContent = {
  bcc: [{ email: "private@example.com", name: null }],
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
  updatedAt: "2026-07-31T10:00:00.000Z",
};
const source = (
  overrides: Readonly<Record<string, unknown>> = {},
): StalwartDraftSendSource => ({
  context: { accountId: "account", draftsMailboxId: "drafts" },
  record: {
    detail,
    email: {
      ...safeStalwartDraftShape({
        bcc: content.bcc,
        from: [{ email: "member@example.com", name: "Member" }],
        htmlPartId: "html",
        messageId: "saved@example.com",
        to: content.to,
      }),
      bcc: content.bcc,
      cc: content.cc,
      from: [{ email: "member@example.com", name: "Member" }],
      inReplyTo: [],
      keywords: {
        $draft: true,
        [jmapDraftComposeKeyword(composeId)]: true,
        [jmapDraftContentKeyword(content)]: true,
      },
      mailboxIds: { drafts: true },
      messageId: ["saved@example.com"],
      references: [],
      to: content.to,
      ...overrides,
    } as unknown as JmapDraftEmail,
    state: "source-state",
  },
});
const context = {
  accountId: "account",
  draftMailboxId: "drafts",
  identity: { email: "member@example.com", id: "identity", name: "Member" },
  sentMailboxId: "sent",
};
const response = (
  ...methodResponses: JmapResponse["methodResponses"]
): JmapResponse => ({
  methodResponses,
  sessionState: "session",
});
const setResult = (
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
const clientFor = (
  batch?: (createId: string) => JmapResponse,
  memberIds: readonly string[] = [providerDraftId],
) => {
  const request = vi.fn(
    async (calls: readonly unknown[][]): Promise<JmapResponse> => {
      const callId = calls[0]?.[2];
      if (callId === "claim-saved-draft") {
        return response([
          "Email/set",
          {
            accountId: "account",
            newState: "claimed-state",
            oldState: "source-state",
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
            ids: memberIds,
            position: 0,
            queryState: "query-state",
            total: memberIds.length,
          },
          "draft-members-query",
        ]);
      }
      if (callId === "create-send-copy") {
        const create = (calls[0]?.[1] as { create: Record<string, unknown> })
          .create;
        return (batch ?? acceptedBatch)(Object.keys(create)[0]!);
      }
      return response([
        "Email/set",
        {
          accountId: "account",
          destroyed: [providerDraftId],
          newState: "clean-state",
          oldState: "claimed-state",
        },
        "destroy-claimed-draft",
      ]);
    },
  );
  return {
    client: { request, result: setResult } as unknown as StalwartJmapClient,
    request,
  };
};
const acceptedBatch = (
  createId: string,
  implicitOldState = "copy-state",
): JmapResponse =>
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
        oldState: implicitOldState,
        updated: { "send-copy": null },
      },
      "submit-saved-draft",
    ],
  );
describe("Stalwart saved draft submission", () => {
  it("claims, copies, submits, and best-effort destroys the old draft", async () => {
    const { client, request } = clientFor();
    await expect(
      submitStalwartSavedDraft(client, content, source(), context),
    ).resolves.toMatchObject({ deliveryStatus: "accepted", id: "send-copy" });

    expect(request).toHaveBeenCalledTimes(4);
    const batch = request.mock.calls[2]?.[0] as readonly unknown[][];
    expect(batch.map(([method]) => method)).toEqual([
      "Email/set",
      "EmailSubmission/set",
    ]);
    const submission = batch[1]?.[1] as Record<string, unknown>;
    expect(submission).toMatchObject({
      create: { submit: { emailId: expect.stringMatching(/^#send-/) } },
    });
    expect(JSON.stringify(batch)).not.toMatch(/x-veda/i);
  });
  it("rejects local attachments before claiming a saved draft", async () => {
    const { client, request } = clientFor();
    await expect(
      submitStalwartSavedDraft(
        client,
        { ...content, attachments: [{} as never] },
        source(),
        context,
      ),
    ).rejects.toThrow("changed since it was last loaded");
    expect(request).not.toHaveBeenCalled();
  });
  it("returns uncertain with the known copy id for malformed submission", async () => {
    const { client } = clientFor((createId) =>
      response([
        "Email/set",
        {
          accountId: "account",
          created: { [createId]: { id: "known-copy" } },
          newState: "copy-state",
          oldState: "claimed-state",
        },
        "create-send-copy",
      ]),
    );
    await expect(
      submitStalwartSavedDraft(client, content, source(), context),
    ).resolves.toMatchObject({ deliveryStatus: "uncertain", id: "known-copy" });
  });
  it("does not submit after a claim reveals a same-compose duplicate", async () => {
    const { client, request } = clientFor(undefined, [
      providerDraftId,
      "duplicate",
    ]);
    await expect(
      submitStalwartSavedDraft(client, content, source(), context),
    ).resolves.toMatchObject({ deliveryStatus: "uncertain" });
    expect(request).toHaveBeenCalledTimes(2);
    expect(
      request.mock.calls.some(
        ([calls]) =>
          (calls as readonly unknown[][])[0]?.[2] === "create-send-copy",
      ),
    ).toBe(false);
  });
});
