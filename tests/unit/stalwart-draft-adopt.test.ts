import { describe, expect, it, vi } from "vitest";

import type { DraftContent, DraftDetail } from "@/domain/mail/draft";
import { id } from "@/domain/shared/brand";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import { adoptImportedStalwartDraft } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-adopt";
import {
  jmapDraftComposeKeyword,
  jmapDraftContentKeyword,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-fingerprint";
import type { JmapDraftEmail } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft.schema";
import type { StalwartDraftRecord } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-record-reader";
import type { StalwartDraftReader } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft.reader";
import { safeStalwartDraftShape } from "./stalwart-draft-safe-shape";

const composeId = id.draft("fbdbd133-d96e-4a21-bdec-686008ba765e");
const content: DraftContent = {
  bcc: [],
  body: "Imported body",
  cc: [],
  subject: "Imported subject",
  to: [{ email: "reader@example.com", name: null }],
};
const account = {
  email: "member@example.com",
  id: id.account("account"),
  name: "Member",
  providerId: id.provider("stalwart-jmap"),
};
const context = {
  accountEmail: account.email,
  accountId: "account",
  draftsMailboxId: "drafts",
};
const imported = (): StalwartDraftRecord => {
  const detail: DraftDetail = {
    composeId: null,
    content,
    hasAttachments: false,
    hasTruncatedContent: false,
    hasUncertainSubmission: false,
    id: id.providerDraft("imported"),
    revision: "revision-imported",
    updatedAt: "2026-07-31T10:00:00.000Z",
  };
  return {
    detail,
    email: {
      ...safeStalwartDraftShape({
        from: [{ email: account.email, name: "Original Draft Name" }],
        messageId: "imported@example.com",
        to: content.to,
      }),
      from: [{ email: account.email, name: "Original Draft Name" }],
      inReplyTo: [],
      keywords: { $draft: true },
      mailboxIds: { drafts: true },
      messageId: ["imported@example.com"],
      references: [],
      to: content.to,
    } as unknown as JmapDraftEmail,
    state: "state-1",
  };
};
const adopted = (source: StalwartDraftRecord): StalwartDraftRecord => ({
  ...source,
  detail: { ...source.detail, composeId },
  email: {
    ...source.email,
    keywords: {
      ...source.email.keywords,
      [jmapDraftComposeKeyword(composeId)]: true,
      [jmapDraftContentKeyword(content)]: true,
    },
  },
  state: "state-2",
});

const setup = () => {
  const request = vi.fn(async (...args: readonly unknown[]) => {
    const boundary = args[3] as { issued: boolean };
    boundary.issued = true;
    return { methodResponses: [], sessionState: "session" };
  });
  const result = vi.fn(() => ({
    accountId: "account",
    newState: "state-2",
    oldState: "state-1",
    updated: { imported: null },
  }));
  const findByComposeId = vi.fn();
  const load = vi.fn();
  return {
    client: { request, result } as unknown as StalwartJmapClient,
    drafts: { findByComposeId, load } as unknown as StalwartDraftReader,
    findByComposeId,
    load,
    request,
  };
};

describe("Stalwart imported draft adoption", () => {
  it("CAS-adopts the exact imported draft before editable saves", async () => {
    const source = imported();
    const next = adopted(source);
    const sole = { ...next, state: "state-3" };
    const { client, drafts, findByComposeId, load, request } = setup();
    findByComposeId.mockResolvedValueOnce(null).mockResolvedValueOnce(sole);
    load.mockResolvedValueOnce(next);
    await expect(
      adoptImportedStalwartDraft(
        client,
        drafts,
        { composeId, content, context, existing: source, state: source.state },
        account,
      ),
    ).resolves.toEqual(sole);
    const calls = request.mock.calls[0]?.[0] as readonly unknown[][];
    expect(calls[0]?.[1]).toMatchObject({
      ifInState: "state-1",
      update: {
        imported: {
          [`keywords/${jmapDraftComposeKeyword(composeId)}`]: true,
          [`keywords/${jmapDraftContentKeyword(content)}`]: true,
        },
      },
    });
  });

  it("reconciles a lost adoption response by exact ID and markers", async () => {
    const source = imported();
    const next = adopted(source);
    const { client, drafts, findByComposeId, load, request } = setup();
    findByComposeId.mockResolvedValueOnce(null).mockResolvedValueOnce(next);
    load.mockResolvedValueOnce(next);
    request.mockImplementationOnce(async (...args: readonly unknown[]) => {
      (args[3] as { issued: boolean }).issued = true;
      throw new Error("lost response");
    });
    await expect(
      adoptImportedStalwartDraft(
        client,
        drafts,
        { composeId, content, context, existing: source, state: source.state },
        account,
      ),
    ).resolves.toEqual(next);
  });

  it("does not mutate when the desired compose ID already exists", async () => {
    const source = imported();
    const { client, drafts, findByComposeId, request } = setup();
    findByComposeId.mockResolvedValueOnce(adopted(source));
    await expect(
      adoptImportedStalwartDraft(
        client,
        drafts,
        { composeId, content, context, existing: source, state: source.state },
        account,
      ),
    ).rejects.toThrow("changed since it was last loaded");
    expect(request).not.toHaveBeenCalled();
  });

  it("does not mutate an imported draft without marker headroom", async () => {
    const original = imported();
    const source = {
      ...original,
      email: {
        ...original.email,
        keywords: {
          $draft: true,
          ...Object.fromEntries(
            Array.from({ length: 1_023 }, (_, index) => [
              `user-keyword-${index}`,
              true,
            ]),
          ),
        },
      } as JmapDraftEmail,
    };
    const { client, drafts, findByComposeId, request } = setup();
    await expect(
      adoptImportedStalwartDraft(
        client,
        drafts,
        { composeId, content, context, existing: source, state: source.state },
        account,
      ),
    ).rejects.toThrow("changed since it was last loaded");
    expect(findByComposeId).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });
});
