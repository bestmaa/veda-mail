import { beforeEach, describe, expect, it, vi } from "vitest";
const draftReaderMocks = vi.hoisted(() => ({
  assertComposeMembers: vi.fn(),
  capability: vi.fn(),
  context: vi.fn(),
  findByComposeId: vi.fn(),
  findByKeyword: vi.fn(),
  get: vi.fn(),
  isPresent: vi.fn(),
  load: vi.fn(),
  state: vi.fn(),
}));
vi.mock(
  "@/infrastructure/providers/stalwart-jmap/stalwart-draft.reader",
  () => ({
    StalwartDraftReader: class {
      public capability = draftReaderMocks.capability;
      public context = draftReaderMocks.context;
      public findByComposeId = draftReaderMocks.findByComposeId;
      public get = draftReaderMocks.get;
      public isPresent = draftReaderMocks.isPresent;
      public load = draftReaderMocks.load;
      public state = draftReaderMocks.state;
    },
  }),
);
vi.mock(
  "@/infrastructure/providers/stalwart-jmap/stalwart-draft-record-reader",
  () => ({
    findStalwartDraftByKeyword: draftReaderMocks.findByKeyword,
  }),
);
vi.mock(
  "@/infrastructure/providers/stalwart-jmap/stalwart-draft-compose-members",
  () => ({
    assertStalwartDraftComposeMembers: draftReaderMocks.assertComposeMembers,
  }),
);
import type { DraftContent, DraftDetail } from "@/domain/mail/draft";
import { id } from "@/domain/shared/brand";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import {
  jmapDraftComposeKeyword,
  jmapDraftContentKeyword,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-fingerprint";
import { replacementOperationKeyword } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-replacement";
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
const context = { accountId: "account", draftsMailboxId: "drafts" };
const account = { email: "member@example.com", name: "Member" };
const detail = (
  providerId: string,
  revision = `revision-${providerId}`,
  value = content,
): DraftDetail => ({
  composeId,
  content: value,
  hasAttachments: false,
  hasTruncatedContent: false,
  hasUncertainSubmission: false,
  id: id.providerDraft(providerId),
  revision,
  updatedAt: "2026-07-31T10:00:00.000Z",
});
const record = (providerId: string, state: string, value = content) => ({
  detail: detail(providerId, `revision-${providerId}`, value),
  email: {
    ...safeStalwartDraftShape({
      bcc: value.bcc,
      from: [account],
      htmlPartId: "html",
      messageId: `${providerId}@example.com`,
      to: value.to,
    }),
    bcc: value.bcc,
    cc: value.cc,
    from: [account],
    keywords: {
      $draft: true,
      $seen: true,
      [jmapDraftComposeKeyword(composeId)]: true,
      [jmapDraftContentKeyword(value)]: true,
    },
    mailboxIds: { drafts: true },
    messageId: [`${providerId}@example.com`],
    inReplyTo: [],
    references: [],
    to: value.to,
  } as unknown as JmapDraftEmail,
  state,
});
const response: JmapResponse = { methodResponses: [], sessionState: "session" };
const setup = () => {
  const request = vi.fn(
    async (...args: readonly unknown[]): Promise<JmapResponse> => {
      const boundary = args[3] as { issued: boolean } | undefined;
      if (boundary) boundary.issued = true;
      return response;
    },
  );
  const result = vi.fn(() => ({
    accountId: "account",
    created: { [`draft-${composeId}`]: { id: "replacement" } },
    destroyed: [] as string[],
    newState: "state-2",
    oldState: "state-1",
  }));
  const client = { request, result } as unknown as StalwartJmapClient;
  const mail = {
    getAccount: vi.fn(async () => ({
      email: "member@example.com",
      id: id.account("account"),
      name: "Member",
      providerId: id.provider("stalwart-jmap"),
    })),
    getReplyContext: vi.fn(),
  } as unknown as StalwartMailReader;
  const store = new StalwartDraftStore(client, mail);
  return { request, result, store };
};
beforeEach(() => {
  vi.resetAllMocks();
  draftReaderMocks.context.mockResolvedValue(context);
  draftReaderMocks.assertComposeMembers.mockResolvedValue(undefined);
  draftReaderMocks.state.mockResolvedValue("state-1");
  draftReaderMocks.findByComposeId.mockResolvedValue(null);
  draftReaderMocks.findByKeyword.mockResolvedValue(null);
  draftReaderMocks.isPresent.mockResolvedValue(false);
});
describe("Stalwart draft save", () => {
  it("replaces and destroys the exact immutable draft with fresh state", async () => {
    const { request, result, store } = setup();
    const old = record("old", "state-old");
    const fresh = { ...old, state: "state-fresh" };
    const soleFresh = { ...fresh, state: "state-sole" };
    const edited = {
      ...content,
      body: "Edited body",
      htmlBody: "<p>Edited body</p>",
    };
    const replacement = record("replacement", "state-new", edited);
    replacement.email.messageId = old.email.messageId;
    const keyword = replacementOperationKeyword(
      {
        accountId: "account",
        composeId,
        content: edited,
        existing: fresh,
      },
      {
        ...account,
        id: id.account("account"),
        providerId: id.provider("stalwart-jmap"),
      },
    );
    replacement.email.keywords = {
      ...replacement.email.keywords,
      [keyword]: true,
    };
    const oldAfterCreate = { ...old, state: "state-new" };
    draftReaderMocks.load
      .mockResolvedValueOnce(old)
      .mockResolvedValueOnce(fresh)
      .mockResolvedValueOnce(fresh)
      .mockResolvedValueOnce(oldAfterCreate);
    draftReaderMocks.findByComposeId
      .mockResolvedValueOnce(soleFresh)
      .mockResolvedValueOnce(replacement);
    draftReaderMocks.findByKeyword
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(replacement);
    result
      .mockReturnValueOnce({
        accountId: "account",
        created: { [`draft-${composeId}`]: { id: "replacement" } },
        destroyed: [],
        newState: "state-new",
        oldState: "state-sole",
      })
      .mockReturnValueOnce({
        accountId: "account",
        created: {},
        destroyed: ["old"],
        newState: "state-final",
        oldState: "state-new",
      });
    await store.save({
      composeId,
      content: edited,
      expectedRevision: old.detail.revision,
      providerDraftId: old.detail.id,
    });
    const createCall = request.mock.calls[0]?.[0] as readonly unknown[][];
    const destroyCall = request.mock.calls[1]?.[0] as readonly unknown[][];
    expect(createCall[0]?.[1]).toMatchObject({ ifInState: "state-sole" });
    expect(destroyCall[0]?.[1]).toMatchObject({
      destroy: ["old"],
      ifInState: "state-new",
    });
  });
  it("rejects a no-op when another draft owns the compose identity", async () => {
    const { request, store } = setup();
    const old = record("old", "state-old");
    draftReaderMocks.load.mockResolvedValue(old);
    draftReaderMocks.findByComposeId.mockResolvedValue(
      record("foreign", "state-old"),
    );
    await expect(
      store.save({
        composeId,
        content,
        expectedRevision: old.detail.revision,
        providerDraftId: old.detail.id,
      }),
    ).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
  it.each([
    ["hasAttachments", true],
    ["hasTruncatedContent", true],
  ] as const)("blocks replacement when %s", async (field, value) => {
    const { request, store } = setup();
    const old = record("old", "state-old");
    old.detail = { ...old.detail, [field]: value };
    draftReaderMocks.load.mockResolvedValueOnce(old);
    await expect(
      store.save({
        composeId,
        content,
        expectedRevision: old.detail.revision,
        providerDraftId: old.detail.id,
      }),
    ).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
});
