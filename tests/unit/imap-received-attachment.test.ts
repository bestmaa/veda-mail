import type { MessageStructureObject } from "imapflow";
import { describe, expect, it } from "vitest";

import { id } from "@/domain/shared/brand";
import {
  bindImapReceivedAttachments,
  findImapReceivedAttachment,
  imapAttachmentAccountScope,
} from "@/infrastructure/providers/imap-smtp/imap-received-attachment";
import type { ImapSmtpMemberConfig } from "@/infrastructure/providers/imap-smtp/imap-smtp.types";

const config: Pick<
  ImapSmtpMemberConfig,
  "imapHost" | "imapPort" | "username"
> = {
  imapHost: "IMAP.Example.com",
  imapPort: "993",
  username: "Member@Example.com",
};

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
  accountScope: imapAttachmentAccountScope(config),
  messageId: id.message("canonical-message"),
  structure: structure(),
  uidValidity: BigInt(42),
  ...overrides,
});

describe("IMAP received attachment identity", () => {
  it("maps sanitized metadata without exposing the IMAP part", () => {
    const [attachment] = bindImapReceivedAttachments(binding());

    expect(attachment?.metadata).toMatchObject({
      disposition: "attachment",
      mimeType: "application/pdf",
      name: "_quarterly_report.pdf",
      size: null,
    });
    expect(attachment?.metadata.id).toMatch(
      /^message-attachment-[A-Za-z0-9_-]+$/u,
    );
    expect(JSON.stringify(attachment?.metadata)).not.toContain('"part"');
    expect(JSON.stringify(attachment?.metadata)).not.toContain("contentId");
    expect(attachment?.contentId).toBeNull();
    expect(attachment?.part).toBe("2");
  });

  it("retains canonical CID metadata internally without serializing it", () => {
    const inline: MessageStructureObject = {
      id: " <logo@example.test> ",
      part: "1",
      size: 256,
      type: "image/png",
    };
    const [attachment] = bindImapReceivedAttachments(
      binding({ structure: inline }),
    );

    expect(attachment).toMatchObject({
      contentId: "logo@example.test",
      metadata: {
        disposition: "inline",
        mimeType: "image/png",
        size: null,
      },
      part: "1",
    });
    expect(JSON.stringify(attachment?.metadata)).not.toContain(
      "logo@example.test",
    );
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

  it("scopes identities to the IMAP service as well as the username", () => {
    const base = imapAttachmentAccountScope(config);

    expect(
      imapAttachmentAccountScope({ ...config, imapHost: "other.example.com" }),
    ).not.toBe(base);
    expect(
      imapAttachmentAccountScope({ ...config, imapPort: "143" }),
    ).not.toBe(base);
    expect(
      imapAttachmentAccountScope({
        imapHost: "imap.example.com",
        imapPort: "993",
        username: "Member@Example.com",
      }),
    ).toBe(base);
    expect(
      imapAttachmentAccountScope({
        imapHost: "imap.example.com",
        imapPort: "993",
        username: "member@example.com",
      }),
    ).not.toBe(base);
  });

  it("binds identities to canonical CID and authoritative disposition", () => {
    const inline = (
      contentId: string,
      disposition?: string,
    ): MessageStructureObject => ({
      ...(disposition ? { disposition } : {}),
      id: contentId,
      part: "1",
      size: 256,
      type: "image/png",
    });
    const attachmentId = (value: MessageStructureObject) =>
      bindImapReceivedAttachments(binding({ structure: value }))[0]?.metadata
        .id;
    const base = attachmentId(inline("<logo@example.test>"));

    expect(attachmentId(inline(" logo@example.test "))).toBe(base);
    expect(attachmentId(inline("<other@example.test>"))).not.toBe(base);
    expect(
      attachmentId(inline("<logo@example.test>", "attachment")),
    ).not.toBe(base);
  });

  it("exposes ambiguous inline Content-IDs as attachment fallbacks", () => {
    const ambiguous: MessageStructureObject = {
      childNodes: [
        {
          id: "<duplicate@example.test>",
          part: "1",
          size: 10,
          type: "image/png",
        },
        {
          id: "duplicate@example.test",
          part: "2",
          size: 20,
          type: "image/jpeg",
        },
        {
          id: "Duplicate@example.test",
          part: "3",
          size: 30,
          type: "image/webp",
        },
      ],
      type: "multipart/related",
    };

    expect(
      bindImapReceivedAttachments(
        binding({ structure: ambiguous }),
      ).map(({ contentId, metadata }) => ({
        contentId,
        disposition: metadata.disposition,
      })),
    ).toEqual([
      {
        contentId: "duplicate@example.test",
        disposition: "attachment",
      },
      {
        contentId: "duplicate@example.test",
        disposition: "attachment",
      },
      {
        contentId: "Duplicate@example.test",
        disposition: "inline",
      },
    ]);
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
