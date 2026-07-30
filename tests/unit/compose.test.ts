import { describe, expect, it } from "vitest";

import {
  createForwardDraft,
  createReplyAllDraft,
  createReplyDraft,
  formatAddressInput,
  normalizeRecipientBuckets,
  parseAddressInput,
  parseRecipientInputs,
  selectForwardableOriginalAttachments,
} from "@/domain/mail/compose";
import type { MailAddress, MessageDetail } from "@/domain/mail/mail";
import { id } from "@/domain/shared/brand";

const address = (email: string, name: string | null = null): MailAddress => ({
  email,
  name,
});

const message = (overrides: Partial<MessageDetail> = {}): MessageDetail => ({
  attachments: [],
  cc: [address("team@example.com", "Team")],
  from: [address("sender@example.com", "Sender")],
  hasAttachment: false,
  htmlBody: null,
  id: id.message("message-1"),
  isStarred: false,
  isUnread: true,
  mailboxIds: [id.mailbox("inbox")],
  preview: "Hello",
  receivedAt: "2026-07-29T10:00:00.000Z",
  replyTo: [],
  size: 100,
  subject: "Project update",
  textBody: "First line\nSecond line",
  threadId: id.thread("thread-1"),
  to: [
    address("me@example.com", "Me"),
    address("other@example.com", "Other"),
  ],
  ...overrides,
});

describe("compose address semantics", () => {
  it("parses comma and semicolon inputs while preserving display names", () => {
    expect(
      parseAddressInput(
        '"Lovelace, Ada" <Ada@Example.com>; Grace Hopper <grace@example.com>, plain@example.com',
      ),
    ).toEqual([
      address("Ada@Example.com", "Lovelace, Ada"),
      address("grace@example.com", "Grace Hopper"),
      address("plain@example.com"),
    ]);
  });

  it("formats names into input that can be parsed without losing data", () => {
    const addresses = [
      address("ada@example.com", "Lovelace, Ada"),
      address("plain@example.com"),
    ];
    expect(parseAddressInput(formatAddressInput(addresses))).toEqual(addresses);
  });

  it("deduplicates addresses case-insensitively across recipient buckets", () => {
    expect(
      normalizeRecipientBuckets({
        bcc: [
          address("three@example.com"),
          address("ONE@example.com", "Duplicate"),
        ],
        cc: [
          address("one@example.com"),
          address("two@example.com", "Two duplicate"),
        ],
        to: [
          address("One@Example.com", "One"),
          address("two@example.com", "Two"),
        ],
      }),
    ).toEqual({
      bcc: [address("three@example.com")],
      cc: [],
      to: [
        address("One@Example.com", "One"),
        address("two@example.com", "Two"),
      ],
    });
  });

  it("parses and deduplicates all three user input buckets", () => {
    expect(
      parseRecipientInputs({
        bcc: "hidden@example.com; PERSON@example.com",
        cc: "person@example.com, cc@example.com",
        to: "Person <person@example.com>",
      }),
    ).toEqual({
      bcc: [address("hidden@example.com")],
      cc: [address("cc@example.com")],
      to: [address("person@example.com", "Person")],
    });
  });
});

describe("reply and forward semantics", () => {
  it("creates a reply to the sender with a stable subject and quoted body", () => {
    const draft = createReplyDraft(message());

    expect(draft.to).toEqual([address("sender@example.com", "Sender")]);
    expect(draft.cc).toEqual([]);
    expect(draft.inReplyTo).toBe("message-1");
    expect(draft.subject).toBe("Re: Project update");
    expect(draft.body).toContain(
      'On 2026-07-29T10:00:00.000Z, "Sender" <sender@example.com> wrote:',
    );
    expect(draft.body).toContain("> First line\n> Second line");
  });

  it("does not stack reply or forward subject prefixes", () => {
    expect(createReplyDraft(message({ subject: "RE: Existing" })).subject).toBe(
      "RE: Existing",
    );
    expect(
      createForwardDraft(message({ subject: "FW: Existing" })).subject,
    ).toBe("FW: Existing");
  });

  it("builds reply-all recipients and excludes the signed-in account", () => {
    const draft = createReplyAllDraft(
      message({
        cc: [
          address("ME@example.com", "Duplicate me"),
          address("other@example.com", "Duplicate other"),
          address("copy@example.com", "Copy"),
        ],
        from: [
          address("sender@example.com", "Sender"),
          address("SECOND@example.com", "Second sender"),
        ],
      }),
      "me@example.com",
    );

    expect(draft.to).toEqual([
      address("sender@example.com", "Sender"),
      address("SECOND@example.com", "Second sender"),
      address("other@example.com", "Other"),
    ]);
    expect(draft.cc).toEqual([address("copy@example.com", "Copy")]);
    expect(draft.bcc).toEqual([]);
  });

  it("prefers Reply-To over From for replies", () => {
    const source = message({
      replyTo: [address("replies@example.net", "Reply desk")],
    });

    expect(createReplyDraft(source).to).toEqual([
      address("replies@example.net", "Reply desk"),
    ]);
    expect(createReplyAllDraft(source, "me@example.com").to[0]).toEqual(
      address("replies@example.net", "Reply desk"),
    );
  });

  it("handles a message without a sender", () => {
    const source = message({ from: [] });

    expect(createReplyDraft(source).to).toEqual([]);
    expect(createReplyDraft(source).body).toContain("Unknown sender wrote:");
    expect(createReplyAllDraft(source, "me@example.com").to).toEqual([
      address("other@example.com", "Other"),
    ]);
  });

  it("creates an addressed header block and empty recipients for forwarding", () => {
    const draft = createForwardDraft(message());

    expect(draft.to).toEqual([]);
    expect(draft.cc).toEqual([]);
    expect(draft.bcc).toEqual([]);
    expect(draft.subject).toBe("Fwd: Project update");
    expect(draft).not.toHaveProperty("inReplyTo");
    expect(draft.body).toContain("---------- Forwarded message ----------");
    expect(draft.body).toContain('From: "Sender" <sender@example.com>');
    expect(draft.body).toContain(
      'To: "Me" <me@example.com>, "Other" <other@example.com>',
    );
    expect(draft.body).toContain('Cc: "Team" <team@example.com>');
    expect(draft.body).toContain("\n\nFirst line\nSecond line");
  });

  it("forwards visible files without promoting rendered inline CID images", () => {
    const inlineImage = {
      disposition: "inline",
      id: id.attachment("inline-cid-image"),
      mimeType: "image/png",
      name: "embedded-logo.png",
      size: 128,
    } as const;
    const visibleFile = {
      disposition: "attachment",
      id: id.attachment("visible-file"),
      mimeType: "application/pdf",
      name: "roadmap.pdf",
      size: 512,
    } as const;

    expect(
      selectForwardableOriginalAttachments(
        message({ attachments: [inlineImage, visibleFile] }),
      ),
    ).toEqual([visibleFile]);
  });
});
