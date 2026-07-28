import "server-only";

import type { MailGateway } from "@/application/ports/mail-provider.port";
import type {
  ComposeInput,
  Mailbox,
  MessageDetail,
  MessageListQuery,
  MessageMutation,
} from "@/domain/mail/mail";
import type { MessageId } from "@/domain/shared/brand";
import { id } from "@/domain/shared/brand";
import type {
  MemberPasswordChange,
  MemberProfileUpdate,
  MemberTwoFactorUpdate,
} from "@/domain/member/member-settings";
import {
  createMockMessages,
  mockMailboxIds,
} from "@/infrastructure/providers/mock/mock-seed";

const mailboxDefinitions = [
  { color: "#4f46e5", id: mockMailboxIds.inbox, name: "Inbox", role: "inbox" },
  { color: "#0ea5e9", id: mockMailboxIds.sent, name: "Sent", role: "sent" },
  { color: "#f59e0b", id: mockMailboxIds.drafts, name: "Drafts", role: "drafts" },
  { color: "#10b981", id: mockMailboxIds.archive, name: "Archive", role: "archive" },
  { color: "#f97316", id: mockMailboxIds.spam, name: "Spam", role: "spam" },
  { color: "#ef4444", id: mockMailboxIds.trash, name: "Trash", role: "trash" },
] as const;

export class MockMailGateway implements MailGateway {
  private messages = createMockMessages();
  private profile = {
    displayName: "Sample Member",
    email: "member@example.com",
  };

  public async changePassword(input: MemberPasswordChange): Promise<void> {
    void input;
  }

  public async getAccount() {
    return {
      email: "member@example.com",
      id: id.account("mock-account"),
      name: "Sample Member",
      providerId: id.provider("mock"),
    };
  }

  public async getMemberProfile() {
    return this.profile;
  }

  public async getTwoFactorEnabled() {
    return false;
  }

  public async getMessage(messageId: MessageId): Promise<MessageDetail> {
    const message = this.messages.find((item) => item.id === messageId);
    if (!message) {
      throw new Error("Message not found.");
    }
    return structuredClone(message);
  }

  public async listMailboxes(): Promise<readonly Mailbox[]> {
    return mailboxDefinitions.map((definition) => {
      const messages = this.messages.filter((message) =>
        message.mailboxIds.includes(definition.id),
      );
      return {
        ...definition,
        total: messages.length,
        unread: messages.filter((message) => message.isUnread).length,
      };
    });
  }

  public async listMessages(query: MessageListQuery) {
    const needle = query.search?.trim().toLocaleLowerCase();
    const matching = this.messages
      .filter((message) => message.mailboxIds.includes(query.mailboxId))
      .filter((message) => {
        if (!needle) {
          return true;
        }
        const senders = message.from.map((address) => address.email).join(" ");
        return `${message.subject} ${message.preview} ${senders}`
          .toLocaleLowerCase()
          .includes(needle);
      })
      .sort((left, right) => right.receivedAt.localeCompare(left.receivedAt));
    const offset = Number(query.cursor ?? "0");
    const items = matching.slice(offset, offset + query.limit);
    const nextOffset = offset + items.length;

    return {
      items: structuredClone(items),
      nextCursor: nextOffset < matching.length ? String(nextOffset) : null,
      total: matching.length,
    };
  }

  public async mutateMessage(mutation: MessageMutation): Promise<void> {
    const index = this.messages.findIndex(
      (message) => message.id === mutation.messageId,
    );
    const current = this.messages[index];
    if (!current) {
      throw new Error("Message not found.");
    }

    if (mutation.type === "set-read") {
      this.messages[index] = { ...current, isUnread: !mutation.value };
      return;
    }
    if (mutation.type === "set-starred") {
      this.messages[index] = { ...current, isStarred: mutation.value };
      return;
    }

    let nextMailbox = mockMailboxIds.inbox;
    if (mutation.type === "archive") {
      nextMailbox = mockMailboxIds.archive;
    } else if (mutation.type === "delete") {
      nextMailbox = mockMailboxIds.trash;
    } else if (mutation.type === "move") {
      nextMailbox = mutation.mailboxId;
    }
    this.messages[index] = { ...current, mailboxIds: [nextMailbox] };
  }

  public async sendMessage(input: ComposeInput) {
    const now = new Date().toISOString();
    const messageId = id.message(`sent-${crypto.randomUUID()}`);
    this.messages.unshift({
      attachments: [],
      cc: input.cc,
      from: [{ email: "member@example.com", name: "Sample Member" }],
      hasAttachment: false,
      htmlBody: null,
      id: messageId,
      isStarred: false,
      isUnread: false,
      mailboxIds: [mockMailboxIds.sent],
      preview: input.body.slice(0, 140),
      receivedAt: now,
      replyTo: [],
      size: new TextEncoder().encode(input.body).byteLength,
      subject: input.subject || "(No subject)",
      textBody: input.body,
      threadId: id.thread(`thread-${messageId}`),
      to: input.to,
    });
    return { id: messageId, submittedAt: now };
  }

  public async testConnection(): Promise<void> {}

  public async updateTwoFactor(input: MemberTwoFactorUpdate): Promise<void> {
    void input;
  }

  public async updateMemberProfile(input: MemberProfileUpdate) {
    this.profile = { ...this.profile, displayName: input.displayName };
    return this.profile;
  }
}
