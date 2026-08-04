import { createHash } from "node:crypto";
import { simpleParser } from "mailparser";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  append: vi.fn(async () => ({ uid: 7, uidValidity: BigInt(123) })),
  assertMessageBytes: vi.fn(async () => undefined),
  sendMail: vi.fn(async (message: unknown) => {
    void message;
    return { messageId: "provider-message" };
  }),
}));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({ sendMail: mocks.sendMail }),
  },
}));

vi.mock("@/infrastructure/providers/imap-smtp/imap-client", () => ({
  withImapClient: async (
    _config: unknown,
    task: (client: {
      append: typeof mocks.append;
      list: () => Promise<readonly { path: string; specialUse: string }[]>;
      mailboxOpen: () => Promise<{ exists: number; uidValidity: bigint }>;
    }) => Promise<unknown>,
  ) =>
    task({
      append: mocks.append,
      list: async () => [{ path: "Sent", specialUse: "\\Sent" }],
      mailboxOpen: async () => ({ exists: 1, uidValidity: BigInt(123) }),
    }),
}));

vi.mock("@/infrastructure/providers/stalwart-jmap/provider-url-policy", () => ({
  assertSafeProviderHost: async () => undefined,
}));

import type { SendMessageInput } from "@/domain/mail/mail";
import { id } from "@/domain/shared/brand";
import { ImapMailWriter } from "@/infrastructure/providers/imap-smtp/imap-mail.writer";
import type { ImapSmtpMemberConfig } from "@/infrastructure/providers/imap-smtp/imap-smtp.types";

const config: ImapSmtpMemberConfig = {
  imapHost: "imap.example.com",
  imapPort: "993",
  imapSecurity: "tls",
  secret: "secret",
  smtpHost: "smtp.example.com",
  smtpMaxMessageBytes: "0",
  smtpPort: "465",
  smtpSecurity: "tls",
  username: "sender@example.com",
};

const baseInput: SendMessageInput = {
  bcc: [],
  body: "Plain fallback",
  cc: [],
  subject: "Rich SMTP",
  to: [{ email: "recipient@example.net", name: null }],
};

const writer = () =>
  new ImapMailWriter(config, {
    assertMessageBytes: mocks.assertMessageBytes,
    getMaxAttachmentBytes: async () => 18 * 1024 * 1024,
  });

beforeEach(() => {
  mocks.append.mockClear();
  mocks.assertMessageBytes.mockClear();
  mocks.sendMail.mockClear();
});

describe("IMAP/SMTP rich writer", () => {
  it("nests text and HTML alternatives inside mixed attachment MIME", async () => {
    const content = Buffer.from([0, 1, 2, 254, 255]);
    await writer().sendMessage({
      ...baseInput,
      attachments: [
        {
          content,
          id: id.attachmentUpload("rich-upload"),
          mimeType: "application/octet-stream",
          name: "evidence.bin",
          sha256: createHash("sha256").update(content).digest("hex"),
          size: content.byteLength,
        },
      ],
      bcc: [{ email: "hidden@example.net", name: null }],
      htmlBody: "<p><strong>Rich</strong> message</p>",
    });
    const submitted = mocks.sendMail.mock.calls[0]?.[0] as
      | {
          readonly envelope: { readonly to: readonly string[] };
          readonly raw: Buffer;
        }
      | undefined;
    if (!submitted) throw new Error("No rich message was submitted.");
    const parsed = await simpleParser(submitted.raw);
    const raw = submitted.raw.toString("utf8");

    expect(parsed.text?.trim()).toBe("Plain fallback");
    expect(parsed.html).toContain("<p><strong>Rich</strong> message</p>");
    expect(parsed.attachments[0]?.content).toEqual(content);
    expect(parsed.bcc).toBeUndefined();
    expect(submitted.envelope.to).toEqual([
      "recipient@example.net",
      "hidden@example.net",
    ]);
    expect(raw).toMatch(/Content-Type: multipart\/mixed/iu);
    expect(raw).toMatch(/Content-Type: multipart\/alternative/iu);
    expect(mocks.assertMessageBytes).toHaveBeenCalledWith(
      submitted.raw.byteLength,
    );
    expect(mocks.append).toHaveBeenCalledWith(
      "Sent",
      submitted.raw,
      ["\\Seen"],
      expect.any(Date),
    );
  });

  it("keeps legacy plain sends as text/plain without an HTML alternative", async () => {
    await writer().sendMessage(baseInput);
    const submitted = mocks.sendMail.mock.calls[0]?.[0] as
      | { readonly raw: Buffer }
      | undefined;
    if (!submitted) throw new Error("No plain message was submitted.");
    const parsed = await simpleParser(submitted.raw);

    expect(parsed.text?.trim()).toBe("Plain fallback");
    expect(parsed.html).toBe(false);
    expect(submitted.raw.toString("utf8")).not.toMatch(
      /multipart\/alternative/iu,
    );
  });

  it("emits an RFC 5545 METHOD=REPLY calendar part", async () => {
    const content = Buffer.from(
      "BEGIN:VCALENDAR\r\nMETHOD:REPLY\r\nEND:VCALENDAR\r\n",
      "utf8",
    );
    await writer().sendMessage({
      ...baseInput,
      attachments: [{
        calendarMethod: "REPLY",
        content,
        id: id.attachmentUpload("calendar-reply"),
        mimeType: "text/calendar",
        name: "reply.ics",
        sha256: createHash("sha256").update(content).digest("hex"),
        size: content.byteLength,
      }],
    });
    const submitted = mocks.sendMail.mock.calls[0]?.[0] as
      | { readonly raw: Buffer }
      | undefined;
    if (!submitted) throw new Error("No calendar reply was submitted.");
    const raw = submitted.raw.toString("utf8");

    expect(raw).toMatch(/Content-Type: text\/calendar;[\s\S]*method=REPLY/iu);
    expect(raw).toMatch(/filename=reply\.ics/iu);
    expect(mocks.assertMessageBytes).toHaveBeenCalledWith(
      submitted.raw.byteLength,
    );
  });
});
