import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  findByComposeId: vi.fn(),
  findByKeyword: vi.fn(),
  load: vi.fn(),
  state: vi.fn(),
}));
vi.mock(
  "@/infrastructure/providers/stalwart-jmap/stalwart-draft.reader",
  () => ({
    StalwartDraftReader: class {
      public context = mocks.context;
      public findByComposeId = mocks.findByComposeId;
      public load = mocks.load;
      public state = mocks.state;
    },
  }),
);
vi.mock(
  "@/infrastructure/providers/stalwart-jmap/stalwart-draft-record-reader",
  () => ({ findStalwartDraftByKeyword: mocks.findByKeyword }),
);

import type { DraftContent, DraftDetail } from "@/domain/mail/draft";
import { id } from "@/domain/shared/brand";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import { StalwartJmapMethodError } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-client-helpers";
import {
  jmapDraftComposeKeyword,
  jmapDraftContentKeyword,
  jmapDraftCreateKeyword,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-fingerprint";
import type { JmapDraftEmail } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft.schema";
import { StalwartDraftStore } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft.store";
import type { StalwartMailReader } from "@/infrastructure/providers/stalwart-jmap/stalwart-mail.reader";
import type { JmapResponse } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";
import { safeStalwartDraftShape } from "./stalwart-draft-safe-shape";

const composeId = id.draft("14f1dc4c-d968-4c56-918f-d8bea471c1bb");
const content: DraftContent = {
  bcc: [{ email: "private@example.com", name: null }],
  body: "Draft body",
  cc: [],
  htmlBody: "<p>Draft body</p>",
  subject: "Draft subject",
  to: [{ email: "reader@example.com", name: null }],
};
const account = { email: "member@example.com", name: "Member" };
const context = { accountId: "account", draftsMailboxId: "drafts" };
const record = (providerId: string, state: string) => {
  const detail: DraftDetail = {
    composeId,
    content,
    hasAttachments: false,
    hasTruncatedContent: false,
    hasUncertainSubmission: false,
    id: id.providerDraft(providerId),
    revision: `revision-${providerId}`,
    updatedAt: "2026-07-31T10:00:00.000Z",
  };
  return {
    detail,
    email: {
      ...safeStalwartDraftShape({
        bcc: content.bcc,
        from: [account],
        htmlPartId: "html",
        messageId: `${providerId}@example.com`,
        to: content.to,
      }),
      bcc: content.bcc,
      cc: content.cc,
      from: [account],
      inReplyTo: [],
      keywords: {
        $draft: true,
        $seen: true,
        [jmapDraftComposeKeyword(composeId)]: true,
        [jmapDraftContentKeyword(content)]: true,
        [jmapDraftCreateKeyword({
          accountId: "account",
          composeId,
          content,
        })]: true,
      },
      mailboxIds: { drafts: true },
      messageId: [`${providerId}@example.com`],
      references: [],
      to: content.to,
    } as unknown as JmapDraftEmail,
    state,
  };
};
const setup = () => {
  const request = vi.fn(async (...args: readonly unknown[]) => {
    const boundary = args[3] as { issued: boolean } | undefined;
    if (boundary) boundary.issued = true;
    return { methodResponses: [], sessionState: "session" } as JmapResponse;
  });
  const result = vi.fn(() => ({
    accountId: "account",
    created: { [`draft-${composeId}`]: { id: "replacement" } },
    destroyed: [],
    newState: "state-2",
    oldState: "state-1",
  }));
  const client = { request, result } as unknown as StalwartJmapClient;
  const getReplyContext = vi.fn();
  const mail = {
    getAccount: vi.fn(async () => ({
      ...account,
      id: id.account("account"),
      providerId: id.provider("stalwart-jmap"),
    })),
    getReplyContext,
  } as unknown as StalwartMailReader;
  return {
    getReplyContext,
    request,
    result,
    store: new StalwartDraftStore(client, mail),
  };
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.context.mockResolvedValue(context);
  mocks.findByComposeId.mockResolvedValue(null);
  mocks.findByKeyword.mockResolvedValue(null);
  mocks.state.mockResolvedValue("state-1");
});

describe("Stalwart draft creation", () => {
  it("creates BCC-preserving content with intent metadata", async () => {
    const { request, store } = setup();
    const replacement = record("replacement", "state-2");
    mocks.load.mockResolvedValueOnce(replacement);
    mocks.findByComposeId
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(replacement);
    await expect(store.save({ composeId, content })).resolves.toMatchObject({
      id: "replacement",
    });
    const calls = request.mock.calls[0]?.[0] as readonly unknown[][];
    const input = calls[0]?.[1] as { create: Record<string, unknown> };
    expect(input).toMatchObject({ ifInState: "state-1" });
    expect(input.create[`draft-${composeId}`]).toMatchObject({
      bcc: [{ email: "private@example.com" }],
      keywords: {
        [jmapDraftComposeKeyword(composeId)]: true,
        [jmapDraftContentKeyword(content)]: true,
      },
    });
  });

  it("reconciles an exact lost create response without duplicating", async () => {
    const { request, store } = setup();
    const recovered = record("created-after-loss", "state-2");
    const sole = { ...recovered, state: "state-3" };
    mocks.findByKeyword
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(recovered);
    mocks.findByComposeId
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(sole);
    request.mockImplementationOnce(async (...args: readonly unknown[]) => {
      (args[3] as { issued: boolean }).issued = true;
      throw new Error("transport lost");
    });
    await expect(store.save({ composeId, content })).resolves.toEqual(
      recovered.detail,
    );
    expect(request).toHaveBeenCalledOnce();
  });

  it("recovers a stable reply intent before mutable reply lookup", async () => {
    const replyContent = {
      ...content,
      inReplyTo: id.message("deleted-reply-source"),
    };
    const { getReplyContext, request, store } = setup();
    const recovered = record("created-before-profile-change", "state-2");
    const previousFrom = { email: account.email, name: "Previous Name" };
    recovered.email = {
      ...recovered.email,
      ...safeStalwartDraftShape({
        bcc: content.bcc,
        from: [previousFrom],
        htmlPartId: "html",
        messageId: "created-before-profile-change@example.com",
        to: content.to,
      }),
      from: [previousFrom],
      keywords: {
        $draft: true,
        $seen: true,
        [jmapDraftComposeKeyword(composeId)]: true,
        [jmapDraftContentKeyword(replyContent)]: true,
        [jmapDraftCreateKeyword({
          accountId: "account",
          composeId,
          content: replyContent,
        })]: true,
      },
    } as unknown as JmapDraftEmail;
    mocks.findByKeyword.mockResolvedValueOnce(recovered);
    mocks.findByComposeId.mockResolvedValueOnce(recovered);
    getReplyContext.mockRejectedValue(new Error("reply was deleted"));
    await expect(
      store.save({ composeId, content: replyContent }),
    ).resolves.toEqual(recovered.detail);
    expect(getReplyContext).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it("does not retry into a concurrent same-compose draft", async () => {
    const { request, result, store } = setup();
    mocks.findByComposeId
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(record("competing", "state-2"));
    result.mockImplementationOnce(() => {
      throw new StalwartJmapMethodError({ type: "stateMismatch" });
    });
    await expect(store.save({ composeId, content })).rejects.toThrow(
      "changed since it was last loaded",
    );
    expect(request).toHaveBeenCalledOnce();
  });
});
