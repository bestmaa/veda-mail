import { describe, expect, it } from "vitest";

import type { DraftContent, DraftDetail } from "@/domain/mail/draft";
import { id } from "@/domain/shared/brand";
import {
  jmapDraftComposeKeyword,
  jmapDraftContentKeyword,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-fingerprint";
import {
  assertReplacementCandidate,
  replacementOperationKeyword,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-replacement";
import { assertEditableExisting } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-save-destroy";
import type { JmapDraftEmail } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft.schema";
import { safeStalwartDraftShape } from "./stalwart-draft-safe-shape";

const composeId = id.draft("14f1dc4c-d968-4c56-918f-d8bea471c1bb");
const account = {
  email: "member@example.com", id: id.account("account"), name: "Member",
  providerId: id.provider("stalwart-jmap"),
};
const from = { email: account.email, name: account.name };
const content: DraftContent = {
  bcc: [], body: "Draft body", cc: [], htmlBody: "<p>Draft body</p>",
  subject: "Draft subject", to: [{ email: "reader@example.com", name: null }],
};

const record = (
  providerId: string,
  value: DraftContent,
  partId: string,
) => {
  const base = safeStalwartDraftShape({
    from: [from], htmlPartId: "html",
    messageId: `${providerId}@example.com`, to: value.to,
  });
  const attachment = {
    blobId: "blob-one", disposition: "attachment", name: "notes.txt",
    partId, size: 12, type: "text/plain",
  };
  const detail: DraftDetail = {
    attachments: [{ disposition: "attachment", id: id.attachment("opaque"),
      mimeType: "text/plain", name: "notes.txt", size: 12 }],
    composeId, content: value, hasAttachments: true,
    hasTruncatedContent: false, hasUncertainSubmission: false,
    id: id.providerDraft(providerId), revision: `revision-${providerId}`,
    updatedAt: "2026-08-02T00:00:00.000Z",
  };
  const email = {
    ...base, attachments: [attachment], bcc: value.bcc, cc: value.cc,
    from: [from], hasAttachment: true, inReplyTo: [], references: [],
    bodyStructure: {
      headers: [{ name: "Content-Type",
        value: 'multipart/mixed; boundary="safe-mixed"' }],
      subParts: [base.bodyStructure!, attachment], type: "multipart/mixed",
    },
    headers: (base.headers ?? []).map((header) =>
      header.name.toLowerCase() === "content-type"
        ? { ...header, value: 'multipart/mixed; boundary="safe-mixed"' }
        : header),
    keywords: {
      $draft: true,
      [jmapDraftComposeKeyword(composeId)]: true,
      [jmapDraftContentKeyword(value)]: true,
    },
    mailboxIds: { drafts: true }, messageId: [`${providerId}@example.com`],
    to: value.to,
  } as unknown as JmapDraftEmail;
  return { detail, email, state: "state" };
};

describe("Stalwart draft attachment replacement", () => {
  it("accepts canonical attachments and binds the replacement blob inventory", () => {
    const old = record("old", content, "attachment-old");
    expect(() => assertEditableExisting(old, old, account)).not.toThrow();
    const edited = { ...content, body: "Edited", htmlBody: "<p>Edited</p>" };
    const candidate = record("replacement", edited, "attachment-new");
    candidate.email.messageId = old.email.messageId;
    const anchor = {
      accountId: "account", attachmentCount: 1,
      attachments: [{ blobId: "blob-one", name: "notes.txt", type: "text/plain" }],
      composeId, content: edited, existing: old,
    };
    const keyword = replacementOperationKeyword(anchor, account);
    candidate.email.keywords = { ...candidate.email.keywords, [keyword]: true };

    expect(() => assertReplacementCandidate(
      candidate, anchor, account, keyword,
    )).not.toThrow();
    const swapped = {
      ...candidate,
      email: { ...candidate.email, attachments: [{
        ...candidate.email.attachments![0]!, blobId: "swapped",
      }] },
    };
    expect(() => assertReplacementCandidate(
      swapped, anchor, account, keyword,
    )).toThrow();
  });
});
