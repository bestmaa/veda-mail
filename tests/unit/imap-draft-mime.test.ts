import { describe, expect, it } from "vitest";

import type { DraftContent } from "@/domain/mail/draft";
import { id } from "@/domain/shared/brand";
import {
  composeImapDraft,
  parseImapDraft,
} from "@/infrastructure/providers/imap-smtp/imap-draft-mime";

const composeId = id.draft("11111111-1111-4111-8111-111111111111");
const providerDraftId = id.providerDraft("provider-draft");
const content: DraftContent = {
  bcc: [{ email: "hidden@example.com", name: "Hidden" }],
  body: "Hello, Veena!\nSecond line.",
  cc: [{ email: "copy@example.com", name: null }],
  htmlBody: "<p>Hello, <strong>Veena</strong>!</p><p>Second line.</p>",
  inReplyTo: id.message("reply-message-reference"),
  subject: "Draft ✓",
  to: [{ email: "veena@example.com", name: "Veena Kumari" }],
};

const parse = (source: Buffer) =>
  parseImapDraft({
    accountScope: "account-scope",
    internalDate: new Date("2026-08-02T08:00:00.000Z"),
    providerDraftId,
    source,
    username: "member@example.com",
  });

describe("IMAP draft MIME", () => {
  it("round-trips canonical rich content, BCC, and reply metadata", async () => {
    const { raw, writeId } = await composeImapDraft(
      content,
      composeId,
      "member@example.com",
    );

    const record = await parse(raw);

    expect(record.detail).toMatchObject({
      composeId,
      content,
      hasAttachments: false,
      hasTruncatedContent: false,
      hasUncertainSubmission: false,
      id: providerDraftId,
      updatedAt: "2026-08-02T08:00:00.000Z",
    });
    expect(raw.toString("utf8")).toContain(`X-Veda-Write-ID: ${writeId}`);
    expect(raw.toString("utf8")).toContain("Bcc: Hidden <hidden@example.com>");
  });

  it("round-trips an exact plain-text-only body", async () => {
    const { htmlBody: _htmlBody, ...withoutHtml } = content;
    void _htmlBody;
    const plain = { ...withoutHtml, body: "No trailing newline" };
    const { raw } = await composeImapDraft(plain, composeId, "member@example.com");

    const record = await parse(raw);

    expect(record.detail.content).toEqual(plain);
    expect(record.detail.hasTruncatedContent).toBe(false);
  });

  it("marks unexpected provider headers as unsafe instead of dropping them", async () => {
    const { raw } = await composeImapDraft(content, composeId, "member@example.com");
    const tampered = Buffer.from(
      raw.toString("utf8").replace("MIME-Version:", "Reply-To: attacker@example.com\r\nMIME-Version:"),
    );

    const record = await parse(tampered);

    expect(record.detail.hasTruncatedContent).toBe(true);
  });

  it("marks a forged identity or content fingerprint as unsafe", async () => {
    const { raw } = await composeImapDraft(content, composeId, "member@example.com");
    const forgedIdentity = await parse(
      Buffer.from(raw.toString("utf8").replace("member@example.com", "other@example.com")),
    );
    const forgedContent = await parse(
      Buffer.from(raw.toString("utf8").replace("Hello, Veena!", "Hello, Mallory!")),
    );

    expect(forgedIdentity.detail.hasTruncatedContent).toBe(true);
    expect(forgedContent.detail.hasTruncatedContent).toBe(true);
  });

  it("rejects named address groups that would be flattened", async () => {
    const { raw } = await composeImapDraft(content, composeId, "member@example.com");
    const grouped = Buffer.from(
      raw.toString("utf8").replace(
        "To: Veena Kumari <veena@example.com>",
        "To: Interview team: Veena Kumari <veena@example.com>;",
      ),
    );

    expect((await parse(grouped)).detail.hasTruncatedContent).toBe(true);
  });

  it("rejects an ignored MIME epilogue even when decoded content is unchanged", async () => {
    const { raw } = await composeImapDraft(content, composeId, "member@example.com");
    const withEpilogue = Buffer.concat([raw, Buffer.from("hidden epilogue\r\n")]);

    expect((await parse(withEpilogue)).detail.hasTruncatedContent).toBe(true);
  });
});
