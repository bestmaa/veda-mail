import { beforeEach, describe, expect, it, vi } from "vitest";

const reader = vi.hoisted(() => ({
  assertComposeMembers: vi.fn(),
  capability: vi.fn(),
  context: vi.fn(),
  findByComposeId: vi.fn(),
  get: vi.fn(),
  isPresent: vi.fn(),
  load: vi.fn(),
  state: vi.fn(),
}));
vi.mock(
  "@/infrastructure/providers/stalwart-jmap/stalwart-draft-compose-members",
  () => ({
    assertStalwartDraftComposeMembers: reader.assertComposeMembers,
  }),
);
vi.mock(
  "@/infrastructure/providers/stalwart-jmap/stalwart-draft.reader",
  () => ({
    StalwartDraftReader: class {
      public capability = reader.capability;
      public context = reader.context;
      public findByComposeId = reader.findByComposeId;
      public get = reader.get;
      public isPresent = reader.isPresent;
      public load = reader.load;
      public state = reader.state;
    },
  }),
);

import type { DraftDetail } from "@/domain/mail/draft";
import { DraftNotFoundError } from "@/domain/mail/draft-errors";
import { id } from "@/domain/shared/brand";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import { StalwartJmapMethodError } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-client-helpers";
import type { JmapDraftEmail } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft.schema";
import { StalwartDraftStore } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft.store";
import type { StalwartMailReader } from "@/infrastructure/providers/stalwart-jmap/stalwart-mail.reader";
import type { JmapResponse } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

const composeId = id.draft("6c38ae3f-02f7-4786-8c1c-696892e1d663");
const providerDraftId = id.providerDraft("provider-draft");
const context = { accountId: "account", draftsMailboxId: "drafts" };
const detail: DraftDetail = {
  composeId,
  content: { bcc: [], body: "body", cc: [], subject: "draft", to: [] },
  hasAttachments: false,
  hasTruncatedContent: false,
  hasUncertainSubmission: false,
  id: providerDraftId,
  revision: "draft-revision",
  updatedAt: "2026-07-31T10:00:00.000Z",
};
const record = (state: string) => ({
  detail,
  email: { keywords: { $draft: true } } as unknown as JmapDraftEmail,
  state,
});
const response: JmapResponse = {
  methodResponses: [],
  sessionState: "session",
};

const setup = () => {
  const request = vi.fn(
    async (...args: readonly unknown[]): Promise<JmapResponse> => {
      const boundary = args[3] as { issued: boolean };
      boundary.issued = true;
      return response;
    },
  );
  const result = vi.fn(() => ({
    accountId: "account",
    destroyed: [providerDraftId] as string[],
    newState: "state-next",
    oldState: "state-current",
  }));
  const client = { request, result } as unknown as StalwartJmapClient;
  const mail = {} as StalwartMailReader;
  return { request, result, store: new StalwartDraftStore(client, mail) };
};

beforeEach(() => {
  vi.clearAllMocks();
  reader.assertComposeMembers.mockResolvedValue(undefined);
  reader.context.mockResolvedValue(context);
  reader.findByComposeId.mockResolvedValue(null);
  reader.isPresent.mockResolvedValue(false);
});

describe("Stalwart draft discard", () => {
  it("destroys the exact draft with the freshly fetched Email state", async () => {
    const { request, store } = setup();
    reader.load.mockResolvedValueOnce(record("state-current"));
    await store.discard(providerDraftId, detail.revision);

    const calls = request.mock.calls[0]?.[0] as readonly unknown[][];
    expect(calls[0]?.[1]).toMatchObject({
      destroy: [providerDraftId],
      ifInState: "state-current",
    });
  });

  it("rejects a stale draft-specific revision before mutation", async () => {
    const { request, store } = setup();
    reader.load.mockResolvedValueOnce(record("state-current"));
    await expect(
      store.discard(providerDraftId, "stale-revision"),
    ).rejects.toThrow("changed since it was last loaded");
    expect(request).not.toHaveBeenCalled();
  });

  it("retries one unrelated account state race after revalidation", async () => {
    const { request, result, store } = setup();
    reader.load
      .mockResolvedValueOnce(record("state-before"))
      .mockResolvedValueOnce(record("state-current"));
    result
      .mockImplementationOnce(() => {
        throw new StalwartJmapMethodError({ type: "stateMismatch" });
      })
      .mockReturnValueOnce({
        accountId: "account",
        destroyed: [providerDraftId],
        newState: "state-next",
        oldState: "state-current",
      });

    await store.discard(providerDraftId, detail.revision);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("reconciles a lost destroy response only when no replacement exists", async () => {
    const { request, store } = setup();
    reader.load
      .mockResolvedValueOnce(record("state-current"))
      .mockRejectedValueOnce(new DraftNotFoundError());
    request.mockImplementationOnce(async (...args: readonly unknown[]) => {
      const boundary = args[3] as { issued: boolean };
      boundary.issued = true;
      throw new Error("transport lost");
    });

    await expect(
      store.discard(providerDraftId, detail.revision),
    ).resolves.toBeUndefined();
    expect(reader.findByComposeId).toHaveBeenCalledWith(context, composeId);
  });

  it("conflicts when a lost response coincides with a replacement", async () => {
    const { request, store } = setup();
    const replacement = {
      ...record("replacement-state"),
      detail: { ...detail, id: id.providerDraft("replacement") },
    };
    reader.load
      .mockResolvedValueOnce(record("state-current"))
      .mockRejectedValueOnce(new DraftNotFoundError());
    reader.findByComposeId.mockResolvedValueOnce(replacement);
    request.mockImplementationOnce(async (...args: readonly unknown[]) => {
      const boundary = args[3] as { issued: boolean };
      boundary.issued = true;
      throw new Error("transport lost");
    });

    await expect(
      store.discard(providerDraftId, detail.revision),
    ).rejects.toThrow("changed since it was last loaded");
  });

  it("conflicts when a lost destroy response finds the draft moved to Sent", async () => {
    const { request, store } = setup();
    reader.load
      .mockResolvedValueOnce(record("state-current"))
      .mockRejectedValueOnce(new DraftNotFoundError());
    reader.isPresent.mockResolvedValueOnce(true);
    request.mockImplementationOnce(async (...args: readonly unknown[]) => {
      const boundary = args[3] as { issued: boolean };
      boundary.issued = true;
      throw new Error("transport lost while another client sent the draft");
    });

    await expect(
      store.discard(providerDraftId, detail.revision),
    ).rejects.toThrow("changed since it was last loaded");
    expect(reader.findByComposeId).not.toHaveBeenCalled();
  });

  it("does not report success when a replacement survives the destroy", async () => {
    const { request, store } = setup();
    reader.load.mockResolvedValueOnce(record("state-current"));
    reader.findByComposeId.mockResolvedValueOnce({
      ...record("state-next"),
      detail: { ...detail, id: id.providerDraft("replacement") },
    });
    await expect(
      store.discard(providerDraftId, detail.revision),
    ).rejects.toThrow("changed since it was last loaded");
    expect(request).toHaveBeenCalledOnce();
  });

  it("blocks destroy when compose membership is already ambiguous", async () => {
    const { request, store } = setup();
    reader.load.mockResolvedValueOnce(record("state-current"));
    reader.assertComposeMembers.mockRejectedValueOnce(new Error("duplicate"));
    await expect(
      store.discard(providerDraftId, detail.revision),
    ).rejects.toThrow("duplicate");
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects malformed partial destroy results", async () => {
    const { result, store } = setup();
    reader.load
      .mockResolvedValueOnce(record("state-current"))
      .mockResolvedValueOnce(record("state-current"));
    result.mockReturnValueOnce({
      accountId: "account",
      destroyed: [],
      newState: "state-next",
      oldState: "state-current",
    });
    await expect(
      store.discard(providerDraftId, detail.revision),
    ).rejects.toThrow("changed since it was last loaded");
  });
});
