import type { MessageStructureObject } from "imapflow";
import { describe, expect, it } from "vitest";

import { id } from "@/domain/shared/brand";
import {
  bindImapReceivedAttachments,
  findImapReceivedAttachment,
} from "@/infrastructure/providers/imap-smtp/imap-received-attachment";

const structure = (
  name = "../quarterly/report.pdf",
): MessageStructureObject => ({
  childNodes: [
    { part: "1", size: 10, type: "text/plain" },
    {
      disposition: "attachment",
      dispositionParameters: { filename: name },
      encoding: "base64",
      part: "2",
      size: 1_024,
      type: "application/pdf",
    },
  ],
  type: "multipart/mixed",
});

const binding = (
  overrides: Partial<Parameters<typeof bindImapReceivedAttachments>[0]> = {},
) => ({
  accountScope: "member@example.com",
  messageId: id.message("canonical-message"),
  structure: structure(),
  uidValidity: BigInt(42),
  ...overrides,
});

describe("IMAP received attachment identity", () => {
  it("maps sanitized metadata without exposing the IMAP part", () => {
    const [attachment] = bindImapReceivedAttachments(binding());

    expect(attachment?.metadata).toMatchObject({
      mimeType: "application/pdf",
      name: "_quarterly_report.pdf",
      size: 1_024,
    });
    expect(attachment?.metadata.id).toMatch(
      /^message-attachment-[A-Za-z0-9_-]+$/u,
    );
    expect(JSON.stringify(attachment?.metadata)).not.toContain('"part"');
    expect(attachment?.part).toBe("2");
  });

  it("binds IDs to account, message, UIDVALIDITY, and metadata", () => {
    const base = bindImapReceivedAttachments(binding())[0]?.metadata.id;
    const variants = [
      binding({ accountScope: "other@example.com" }),
      binding({ messageId: id.message("another-message") }),
      binding({ uidValidity: BigInt(43) }),
      binding({ structure: structure("another.pdf") }),
    ].map(
      (input) => bindImapReceivedAttachments(input)[0]?.metadata.id,
    );

    expect(base).toBeTruthy();
    for (const variant of variants) expect(variant).not.toBe(base);
  });

  it("uses a constant-time opaque ID match and fails closed", () => {
    const input = binding();
    const attachment = bindImapReceivedAttachments(input)[0];
    if (!attachment) throw new Error("Missing attachment fixture.");

    expect(
      findImapReceivedAttachment(input, attachment.metadata.id),
    ).toEqual(attachment);
    expect(
      findImapReceivedAttachment(input, "message-attachment-invalid"),
    ).toBeNull();
  });

  it("rejects an invalid UIDVALIDITY value", () => {
    expect(() =>
      bindImapReceivedAttachments(binding({ uidValidity: BigInt(0) })),
    ).toThrow(/UIDVALIDITY/u);
  });
});
