import "server-only";

import type {
  Mailbox,
  MailboxMutation,
  MailboxMutationResult,
  MessageDetail,
} from "@/domain/mail/mail";
import { assertMailboxMutation } from "@/domain/mail/mailbox-policy";
import { id } from "@/domain/shared/brand";
import { mockMailboxIds } from "@/infrastructure/providers/mock/mock-seed";

type Definition = Omit<Mailbox, "total" | "unread">;

const rights = (custom = false) => ({
  mayCreateChild: true,
  mayDelete: custom,
  mayRemoveItems: true,
  mayRename: custom,
});

const initialDefinitions = (): Definition[] => [
  { color: "#4f46e5", id: mockMailboxIds.inbox, name: "Inbox", parentId: null,
    role: "inbox", rights: rights(), sortOrder: 10 },
  { color: "#0ea5e9", id: mockMailboxIds.sent, name: "Sent", parentId: null,
    role: "sent", rights: rights(), sortOrder: 20 },
  { color: "#f59e0b", id: mockMailboxIds.drafts, name: "Drafts", parentId: null,
    role: "drafts", rights: rights(), sortOrder: 30 },
  { color: "#10b981", id: mockMailboxIds.archive, name: "Archive", parentId: null,
    role: "archive", rights: rights(), sortOrder: 40 },
  { color: "#f97316", id: mockMailboxIds.spam, name: "Spam", parentId: null,
    role: "spam", rights: rights(), sortOrder: 50 },
  { color: "#ef4444", id: mockMailboxIds.trash, name: "Trash", parentId: null,
    role: "trash", rights: rights(), sortOrder: 60 },
];

export class MockMailboxStore {
  private definitions = initialDefinitions();

  public list(messages: readonly MessageDetail[]): readonly Mailbox[] {
    return this.definitions.map((definition) => {
      const matching = messages.filter((message) =>
        message.mailboxIds.includes(definition.id),
      );
      return {
        ...definition,
        total: matching.length,
        unread: matching.filter((message) => message.isUnread).length,
      };
    });
  }

  public mutate(
    mutation: MailboxMutation,
    messages: readonly MessageDetail[],
  ): MailboxMutationResult {
    assertMailboxMutation(this.list(messages), mutation);
    if (mutation.type === "create") {
      const mailboxId = id.mailbox(`mock-custom-${crypto.randomUUID()}`);
      this.definitions.push({
        color: "#64748b",
        id: mailboxId,
        name: mutation.name,
        parentId: mutation.parentId,
        role: "custom",
        rights: rights(true),
        sortOrder: 1_000 + this.definitions.length,
      });
      return { mailboxId, mailboxes: this.list(messages) };
    }
    const index = this.definitions.findIndex(({ id: mailboxId }) =>
      mailboxId === mutation.mailboxId,
    );
    const current = this.definitions[index];
    if (!current) throw new Error("Mailbox not found.");
    if (mutation.type === "delete") {
      this.definitions.splice(index, 1);
      return { mailboxId: null, mailboxes: this.list(messages) };
    }
    this.definitions[index] = {
      ...current,
      ...(mutation.name === undefined ? {} : { name: mutation.name }),
      ...(mutation.parentId === undefined ? {} : { parentId: mutation.parentId }),
    };
    return { mailboxId: current.id, mailboxes: this.list(messages) };
  }
}
