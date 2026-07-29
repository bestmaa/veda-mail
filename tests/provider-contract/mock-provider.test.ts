import { describe, expect, it } from "vitest";

import { id } from "@/domain/shared/brand";
import { MockMailGateway } from "@/infrastructure/providers/mock/mock-mail.gateway";
import {
  createMockRoadmapAttachmentBytes,
  mockRoadmapAttachment,
} from "@/infrastructure/providers/mock/mock-seed";

describe("mock provider contract", () => {
  it("lists mailboxes and paginated messages", async () => {
    const gateway = new MockMailGateway();
    const mailboxes = await gateway.listMailboxes();
    const inbox = mailboxes.find((mailbox) => mailbox.role === "inbox");

    expect(inbox).toBeDefined();
    const page = await gateway.listMessages({
      limit: 2,
      mailboxId: inbox?.id ?? id.mailbox("missing"),
    });
    expect(page.items).toHaveLength(2);
    expect(page.total).toBeGreaterThan(2);
    expect(page.nextCursor).toBe("2");
  });

  it("supports read, star, archive and send mutations", async () => {
    const gateway = new MockMailGateway();
    const inbox = (await gateway.listMailboxes()).find(
      (mailbox) => mailbox.role === "inbox",
    );
    expect(inbox).toBeDefined();
    const page = await gateway.listMessages({
      limit: 10,
      mailboxId: inbox?.id ?? id.mailbox("missing"),
    });
    const message = page.items[0];
    expect(message).toBeDefined();
    if (!message) {
      return;
    }

    await gateway.mutateMessage({
      messageId: message.id,
      type: "set-starred",
      value: true,
    });
    await gateway.mutateMessage({
      messageId: message.id,
      type: "set-read",
      value: true,
    });
    const updated = await gateway.getMessage(message.id);
    expect(updated.isStarred).toBe(true);
    expect(updated.isUnread).toBe(false);

    await gateway.mutateMessage({ messageId: message.id, type: "archive" });
    const archive = (await gateway.listMailboxes()).find(
      (mailbox) => mailbox.role === "archive",
    );
    const archived = await gateway.listMessages({
      limit: 20,
      mailboxId: archive?.id ?? id.mailbox("missing"),
    });
    expect(archived.items.some((item) => item.id === message.id)).toBe(true);

    const receipt = await gateway.sendMessage({
      bcc: [],
      body: "Provider contract test",
      cc: [],
      subject: "A test message",
      to: [{ email: "recipient@example.com", name: null }],
    });
    expect(receipt.id).toContain("sent-");
  });

  it("downloads the exact attachment bytes with truthful metadata", async () => {
    const expected = createMockRoadmapAttachmentBytes();
    const download = await new MockMailGateway().downloadAttachment({
      attachmentId: mockRoadmapAttachment.id,
      maxBytes: expected.byteLength,
      messageId: mockRoadmapAttachment.messageId,
    });

    expect(download.name).toBe(mockRoadmapAttachment.name);
    expect(download.size).toBe(expected.byteLength);
    const received = new Uint8Array(
      await new Response(download.body).arrayBuffer(),
    );
    expect(received).toEqual(expected);
  });

  it("scopes attachment IDs to their exact message", async () => {
    const gateway = new MockMailGateway();
    const input = {
      attachmentId: mockRoadmapAttachment.id,
      maxBytes: 1_024,
    };
    await expect(
      gateway.downloadAttachment({
        ...input,
        messageId: id.message("msg-welcome"),
      }),
    ).rejects.toThrow("Attachment not found.");
    await expect(
      gateway.downloadAttachment({
        ...input,
        attachmentId: id.attachment("missing"),
        messageId: mockRoadmapAttachment.messageId,
      }),
    ).rejects.toThrow("Attachment not found.");
  });

  it("rejects invalid limits and oversized downloads before streaming", async () => {
    const gateway = new MockMailGateway();
    const content = createMockRoadmapAttachmentBytes();
    const validInput = {
      attachmentId: mockRoadmapAttachment.id,
      messageId: mockRoadmapAttachment.messageId,
    };

    for (const maxBytes of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(
        gateway.downloadAttachment({ ...validInput, maxBytes }),
      ).rejects.toThrow("positive safe integer");
    }
    await expect(
      gateway.downloadAttachment({
        ...validInput,
        maxBytes: content.byteLength - 1,
      }),
    ).rejects.toThrow("download byte limit");
  });

  it("honors abort and stream cancellation", async () => {
    const gateway = new MockMailGateway();
    const beforeStart = new AbortController();
    beforeStart.abort();
    const input = {
      attachmentId: mockRoadmapAttachment.id,
      maxBytes: 1_024,
      messageId: mockRoadmapAttachment.messageId,
    };
    await expect(
      gateway.downloadAttachment({ ...input, signal: beforeStart.signal }),
    ).rejects.toMatchObject({ code: "aborted" });

    const duringRead = new AbortController();
    const download = await gateway.downloadAttachment({
      ...input,
      signal: duringRead.signal,
    });
    const reader = download.body.getReader();
    const first = await reader.read();
    expect(first.done).toBe(false);
    await reader.cancel();
    expect(await reader.read()).toEqual({ done: true, value: undefined });

    const interrupted = await gateway.downloadAttachment({
      ...input,
      signal: duringRead.signal,
    });
    const interruptedReader = interrupted.body.getReader();
    duringRead.abort();
    await expect(interruptedReader.read()).rejects.toMatchObject({
      code: "aborted",
    });
  });
});
