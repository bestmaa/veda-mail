import { describe, expect, it, vi } from "vitest";

import type { MailApplicationService } from "@/application/services/mail-application.service";
import type { ConversationPage } from "@/domain/mail/conversation";
import type { MessageDetail } from "@/domain/mail/mail";
import { MAX_PRINT_CONVERSATION_PAGES } from "@/domain/mail/message-print";
import { id } from "@/domain/shared/brand";
import { createMessagePrintDocument } from "@/server/mail/message-print";

const detail = (messageId: string): MessageDetail => ({
  attachments: [{
    disposition: "attachment",
    id: id.attachment(`attachment-${messageId}`),
    mimeType: "text/plain",
    name: `${messageId}.txt`,
    size: 12,
  }, {
    disposition: "inline",
    id: id.attachment(`inline-${messageId}`),
    mimeType: "image/png",
    name: "tracking.png",
    size: 24,
  }],
  cc: [],
  from: [{ email: "sender@example.com", name: "Sender" }],
  hasAttachment: true,
  htmlBody: '<p>Hello</p><img data-veda-inline-image="inline"><script>alert(1)</script>',
  id: id.message(messageId),
  isStarred: false,
  isUnread: false,
  labelIds: [],
  mailboxIds: [id.mailbox("inbox")],
  preview: "Hello",
  receivedAt: "2026-08-09T01:00:00.000Z",
  replyTo: [],
  size: 128,
  subject: "Printable",
  textBody: "Hello",
  threadId: id.thread("thread-one"),
  to: [{ email: "member@example.com", name: null }],
});

const page = (
  ids: readonly string[],
  nextCursor: string | null,
): ConversationPage => ({
  anchorMessageId: id.message("anchor"),
  items: ids.map((messageId) => detail(messageId)),
  nextCursor,
  strategy: "native",
  total: 3,
  truncated: false,
});

const service = (input: {
  readonly getConversation?: ReturnType<typeof vi.fn>;
  readonly getMessage?: ReturnType<typeof vi.fn>;
}) => input as unknown as MailApplicationService;

describe("message print document", () => {
  it("defense-in-depth sanitizes bodies and omits inline attachment metadata", async () => {
    const getMessage = vi.fn().mockResolvedValue(detail("anchor"));
    const document = await createMessagePrintDocument(
      service({ getMessage }),
      id.message("anchor"),
      "message",
    );

    expect(document.messages).toHaveLength(1);
    expect(document.messages[0]?.htmlBody).toBe("<p>Hello</p>");
    expect(document.messages[0]?.attachments).toEqual([{
      mimeType: "text/plain",
      name: "anchor.txt",
      size: 12,
    }]);
    expect(JSON.stringify(document)).not.toContain("data-veda-inline-image");
    expect(JSON.stringify(document)).not.toContain("script");
  });

  it("loads ordered, deduplicated conversation pages through the portable contract", async () => {
    const getConversation = vi.fn()
      .mockResolvedValueOnce(page(["anchor", "middle"], "cursor-two"))
      .mockResolvedValueOnce(page(["middle", "last"], null));
    const getMessage = vi.fn(async (messageId: string) => detail(messageId));

    const document = await createMessagePrintDocument(
      service({ getConversation, getMessage }),
      id.message("anchor"),
      "conversation",
    );

    expect(document.messages.map(({ id: messageId }) => messageId)).toEqual([
      "anchor", "middle", "last",
    ]);
    expect(document).toMatchObject({ total: 3, truncated: false });
    expect(getConversation).toHaveBeenNthCalledWith(2, {
      anchorMessageId: "anchor",
      cursor: "cursor-two",
      limit: 25,
    });
  });

  it("fails closed on repeated cursors, missing anchors, and mismatched details", async () => {
    const repeatedConversation = vi.fn()
      .mockResolvedValueOnce(page(["anchor"], "repeat"))
      .mockResolvedValueOnce(page(["anchor"], "repeat"));
    await expect(createMessagePrintDocument(
      service({ getConversation: repeatedConversation }),
      id.message("anchor"),
      "conversation",
    )).rejects.toThrow("repeated a conversation cursor");

    const missingAnchor = vi.fn().mockResolvedValue(page(["other"], null));
    await expect(createMessagePrintDocument(
      service({ getConversation: missingAnchor }),
      id.message("anchor"),
      "conversation",
    )).rejects.toThrow("omitted the selected conversation message");

    const mismatch = vi.fn().mockResolvedValue(detail("other"));
    await expect(createMessagePrintDocument(
      service({ getMessage: mismatch }),
      id.message("anchor"),
      "message",
    )).rejects.toThrow("mismatched message");
  });

  it("bounds adversarial sparse pagination and reports the omitted remainder", async () => {
    const getConversation = vi.fn().mockImplementation(() =>
      Promise.resolve(page(
        ["anchor"],
        `cursor-${getConversation.mock.calls.length}`,
      )),
    );
    const getMessage = vi.fn().mockResolvedValue(detail("anchor"));

    const document = await createMessagePrintDocument(
      service({ getConversation, getMessage }),
      id.message("anchor"),
      "conversation",
    );

    expect(getConversation).toHaveBeenCalledTimes(MAX_PRINT_CONVERSATION_PAGES);
    expect(document).toMatchObject({ truncated: true });
    expect(document.messages).toHaveLength(1);
  });
});
