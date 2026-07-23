import { describe, expect, it } from "vitest";

import { id } from "@/domain/shared/brand";
import { MockMailGateway } from "@/infrastructure/providers/mock/mock-mail.gateway";

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
});
