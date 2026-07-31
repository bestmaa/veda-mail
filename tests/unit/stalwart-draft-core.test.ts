import { describe, expect, it, vi } from "vitest";

import { id } from "@/domain/shared/brand";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import {
  jmapDraftRevision,
  mapJmapDraft,
  matchesStoredJmapDraftContent,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-draft.mapper";
import { createdDraftId } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-mutation";
import { StalwartDraftReader } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft.reader";
import {
  jmapDraftEmailSchema,
  jmapDraftSetResultSchema,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-draft.schema";
import {
  jmapDraftComposeKeyword,
  jmapDraftContentKeyword,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-fingerprint";
import type { StalwartMailReader } from "@/infrastructure/providers/stalwart-jmap/stalwart-mail.reader";
import { JMAP_MAIL } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";
import { safeStalwartDraftShape } from "./stalwart-draft-safe-shape";

const composeId = id.draft("6f9b53cf-fdb9-4c41-afd0-73c09bfb58d0");
const draftsMailboxId = "drafts";
const content = {
  bcc: [{ email: "hidden@example.com", name: null }],
  body: "Safe body",
  cc: [],
  htmlBody: "<p>Safe body</p>",
  inReplyTo: id.message("original-email"),
  subject: "",
  to: [{ email: "reader@example.com", name: "Reader" }],
};

const draftEmail = (overrides: Readonly<Record<string, unknown>> = {}) =>
  jmapDraftEmailSchema.parse({
    ...safeStalwartDraftShape({
      bcc: content.bcc,
      from: [{ email: "member@example.com", name: "Member" }],
      htmlPartId: "html",
      messageId: "draft@example.com",
      to: content.to,
    }),
    attachments: [],
    bcc: content.bcc,
    bodyValues: {
      html: { value: content.htmlBody },
      text: { value: content.body },
    },
    cc: [],
    hasAttachment: false,
    id: "provider-draft",
    from: [{ email: "member@example.com", name: "Member" }],
    inReplyTo: [],
    keywords: {
      $draft: true,
      [jmapDraftComposeKeyword(composeId)]: true,
      [jmapDraftContentKeyword(content)]: true,
    },
    mailboxIds: { [draftsMailboxId]: true },
    messageId: ["draft@example.com"],
    receivedAt: "2026-07-31T10:00:00.000Z",
    references: [],
    subject: "",
    to: content.to,
    ...overrides,
  });

describe("Stalwart draft core", () => {
  it("maps safe editable content while preserving BCC and reply metadata", () => {
    const detail = mapJmapDraft(
      draftEmail(),
      "account",
      draftsMailboxId,
    );

    expect(detail).toMatchObject({
      composeId,
      content: {
        bcc: content.bcc,
        body: content.body,
        subject: "",
      },
      hasAttachments: false,
      hasTruncatedContent: false,
    });
    expect(detail.content.htmlBody).toBe("<p>Safe body</p>");
    expect(detail.revision).toBe(
      jmapDraftRevision("account", "provider-draft"),
    );
    expect(detail.revision).not.toBe(
      jmapDraftRevision("account", "other-version"),
    );
  });

  it("marks bounded provider content as non-editable", () => {
    const detail = mapJmapDraft(
      draftEmail({
        bodyValues: {
          html: { isTruncated: true, value: "<p>partial</p>" },
          text: { value: "partial" },
        },
      }),
      "account",
      draftsMailboxId,
    );
    expect(detail.hasTruncatedContent).toBe(true);
  });

  it("fails closed when a requested body value is absent", () => {
    const missingValue = mapJmapDraft(
      draftEmail({ bodyValues: { text: { value: content.body } } }),
      "account",
      draftsMailboxId,
    );
    const missingPartId = mapJmapDraft(
      draftEmail({ htmlBody: [{ type: "text/html" }] }),
      "account",
      draftsMailboxId,
    );
    expect(missingValue.hasTruncatedContent).toBe(true);
    expect(missingPartId.hasTruncatedContent).toBe(true);
  });

  it("rejects messages that are not drafts in the Drafts mailbox", () => {
    expect(() =>
      mapJmapDraft(
        draftEmail({ keywords: { $draft: false } }),
        "account",
        draftsMailboxId,
      ),
    ).toThrow("Draft not found");
    expect(() =>
      mapJmapDraft(
        draftEmail({ mailboxIds: { inbox: true } }),
        "account",
        draftsMailboxId,
      ),
    ).toThrow("Draft not found");
  });

  it("treats the content fingerprint as advisory, not proof", () => {
    const email = draftEmail({
      bodyValues: {
        html: { value: "<p>provider-normalized body</p>" },
        text: { value: "provider-normalized body" },
      },
    });
    const mapped = mapJmapDraft(email, "account", draftsMailboxId);
    expect(
      matchesStoredJmapDraftContent(email, mapped.content, content),
    ).toBe(false);
    expect(
      matchesStoredJmapDraftContent(email, mapped.content, {
        ...content,
        subject: "Changed intent",
      }),
    ).toBe(false);
  });

  it("validates complete create and replacement Email/set results", () => {
    const valid = {
      accountId: "account",
      created: { create: { id: "replacement" } },
      destroyed: ["old"],
      newState: "state-2",
      oldState: "state-1",
    };
    expect(jmapDraftSetResultSchema.safeParse(valid).success).toBe(true);
    for (const malformed of [
      { ...valid, accountId: undefined },
      { ...valid, newState: undefined },
      { ...valid, created: { create: {} } },
      { ...valid, destroyed: [42] },
      { ...valid, notDestroyed: [] },
    ]) {
      expect(jmapDraftSetResultSchema.safeParse(malformed).success).toBe(false);
    }
  });

  it("rejects contradictory or partial replacement outcomes", () => {
    const payload = {
      accountId: "account",
      created: { create: { id: "replacement" } },
      destroyed: [],
      newState: "state-2",
      oldState: "state-1",
    };
    const client = {
      result: vi.fn(() => jmapDraftSetResultSchema.parse(payload)),
    } as unknown as StalwartJmapClient;
    expect(() =>
      createdDraftId(
        client,
        { methodResponses: [], sessionState: "session" },
        "save-draft",
        "account",
        "state-1",
        "create",
        id.providerDraft("old"),
      ),
    ).toThrow("changed since it was last loaded");
  });

  it.each([
    [false, true, "supported"],
    [true, true, "read-only"],
    [false, false, "unavailable"],
  ])(
    "reports runtime capability for readOnly=%s mail=%s",
    async (isReadOnly, hasMail, status) => {
      const client = {
        getSession: vi.fn(async () => ({
          accounts: { account: { isReadOnly, name: "Account" } },
          capabilities: hasMail ? { [JMAP_MAIL]: {} } : {},
          primaryAccounts: { [JMAP_MAIL]: "account" },
        })),
      } as unknown as StalwartJmapClient;
      const mail = {
        getAccount: vi.fn(async () => ({
          email: "member@example.com",
          id: id.account("account"),
          name: "Member",
          providerId: id.provider("stalwart-jmap"),
        })),
        listMailboxes: vi.fn(async () => [
          {
            color: "#000000",
            id: id.mailbox(draftsMailboxId),
            name: "Drafts",
            role: "drafts" as const,
            total: 0,
            unread: 0,
          },
        ]),
      } as unknown as StalwartMailReader;
      await expect(
        new StalwartDraftReader(client, mail).capability(),
      ).resolves.toEqual({ status });
    },
  );
});
