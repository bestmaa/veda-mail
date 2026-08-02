import { describe, expect, it } from "vitest";

import type { DraftContent } from "@/domain/mail/draft";
import { id } from "@/domain/shared/brand";
import { createJmapDraftObject } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft.composer";
import {
  jmapDraftComposeKeyword,
  jmapDraftContentKeyword,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-fingerprint";
import { mapJmapDraft } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft.mapper";
import { jmapDraftEmailSchema } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft.schema";

const composeId = id.draft("11111111-1111-4111-8111-111111111111");
const content: DraftContent = {
  bcc: [],
  body: "hello body",
  cc: [],
  subject: "what is new",
  to: [{ email: "target@example.com", name: null }],
};

const rootHeaders = (bccValue = "") => [
  { name: "To", value: " <target@example.com>" },
  { name: "Bcc", value: bccValue },
  { name: "Cc", value: "" },
  { name: "From", value: " <member@contract.test>" },
  { name: "Message-ID", value: " <draft@contract.test>" },
  { name: "Date", value: " Sun, 2 Aug 2026 16:37:54 +0000" },
  { name: "Subject", value: " what is new" },
  { name: "MIME-Version", value: " 1.0" },
  { name: "Content-Type", value: ' text/plain; charset="utf-8"' },
  { name: "Content-Transfer-Encoding", value: " 7bit" },
];

const providerPayload = (bccValue = "") => {
  const headers = rootHeaders(bccValue);
  const plainPart = {
    charset: "utf-8",
    cid: null,
    disposition: null,
    headers,
    language: null,
    location: null,
    name: null,
    partId: "0",
    type: "text/plain",
  };
  return {
    attachments: [],
    bcc: null,
    bodyStructure: plainPart,
    bodyValues: {
      "0": {
        isEncodingProblem: false,
        isTruncated: false,
        value: "hello body",
      },
    },
    cc: null,
    from: [{ email: "member@contract.test", name: null }],
    hasAttachment: false,
    headers,
    "header:Bcc:asGroupedAddresses:all": [null],
    "header:Cc:asGroupedAddresses:all": [null],
    "header:From:asGroupedAddresses:all": [
      [
        {
          addresses: [{ email: "member@contract.test", name: null }],
          name: null,
        },
      ],
    ],
    "header:To:asGroupedAddresses:all": [
      [
        {
          addresses: [{ email: "target@example.com", name: null }],
          name: null,
        },
      ],
    ],
    htmlBody: [plainPart],
    id: "provider-draft",
    inReplyTo: null,
    keywords: {
      $draft: true,
      $seen: true,
      [jmapDraftComposeKeyword(composeId)]: true,
      [jmapDraftContentKeyword(content)]: true,
    },
    mailboxIds: { drafts: true },
    messageId: ["draft@contract.test"],
    receivedAt: "2026-08-02T16:37:54Z",
    references: null,
    replyTo: null,
    sender: null,
    subject: "what is new",
    textBody: [plainPart],
    to: content.to,
  };
};

describe("Stalwart production draft compatibility", () => {
  it("loads the bounded plain-draft shape returned by Stalwart 0.16", () => {
    const email = jmapDraftEmailSchema.parse(providerPayload());
    const detail = mapJmapDraft(
      email,
      "account",
      "drafts",
      undefined,
      "member@contract.test",
    );

    expect(email.htmlBody).toEqual([]);
    expect(detail.content).toEqual(content);
    expect(detail.hasTruncatedContent).toBe(false);
  });

  it("rejects a non-empty address header that Stalwart could not parse", () => {
    const email = jmapDraftEmailSchema.parse(
      providerPayload("undisclosed-recipients:;"),
    );
    const detail = mapJmapDraft(email, "account", "drafts");

    expect(detail.hasTruncatedContent).toBe(true);
  });

  it("does not create empty recipient headers for new drafts", () => {
    const draft = createJmapDraftObject(
      content,
      composeId,
      "drafts",
      { email: "member@contract.test", name: "Member" },
      null,
    );

    expect(draft).not.toHaveProperty("bcc");
    expect(draft).not.toHaveProperty("cc");
    expect(draft).toMatchObject({
      to: [{ email: "target@example.com" }],
    });
  });
});
