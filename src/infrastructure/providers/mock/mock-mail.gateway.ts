import "server-only";

import type { MailGateway } from "@/application/ports/mail-provider.port";
import type {
  AttachmentDownloadInput,
  Mailbox,
  MessageDetail,
  MessageAttachmentListInput,
  MessageListQuery,
  MessageMutation,
  SendMessageInput,
} from "@/domain/mail/mail";
import type { MessageId } from "@/domain/shared/brand";
import { id } from "@/domain/shared/brand";
import { AttachmentDownloadError } from "@/domain/mail/attachment-download-error";
import type {
  MemberPasswordChange,
  MemberProfileUpdate,
  MemberTwoFactorUpdate,
} from "@/domain/member/member-settings";
import {
  downloadMockMessageAttachment,
  listMockMessageAttachments,
} from "@/infrastructure/providers/mock/mock-received-attachment.reader";
import {
  createMockAttachmentContents,
  createMockMessages,
  mockMailboxIds,
} from "@/infrastructure/providers/mock/mock-seed";
import { mockArchiveFailureMessageId } from "@/infrastructure/providers/mock/mock-archive-fixture";

const mailboxDefinitions = [
  { color: "#4f46e5", id: mockMailboxIds.inbox, name: "Inbox", role: "inbox" },
  { color: "#0ea5e9", id: mockMailboxIds.sent, name: "Sent", role: "sent" },
  {
    color: "#f59e0b",
    id: mockMailboxIds.drafts,
    name: "Drafts",
    role: "drafts",
  },
  {
    color: "#10b981",
    id: mockMailboxIds.archive,
    name: "Archive",
    role: "archive",
  },
  { color: "#f97316", id: mockMailboxIds.spam, name: "Spam", role: "spam" },
  { color: "#ef4444", id: mockMailboxIds.trash, name: "Trash", role: "trash" },
] as const;

export class MockMailGateway implements MailGateway {
  private readonly attachmentContents = createMockAttachmentContents();
  private archiveFailureLookups = 0;
  private messages = createMockMessages();
  private profile = {
    displayName: "Sample Member",
    email: "member@example.com",
  };
  public async changePassword(input: MemberPasswordChange): Promise<void> {
    void input;
  }
  public async downloadAttachment(
    input: AttachmentDownloadInput,
  ) {
    return downloadMockMessageAttachment(
      this.messages,
      this.attachmentContents,
      input,
    );
  }

  public async getAccount() {
    return {
      email: "member@example.com",
      id: id.account("mock-account"),
      name: "Sample Member",
      providerId: id.provider("mock"),
    };
  }

  public async getMaxAttachmentBytes() {
    return 18 * 1024 * 1024;
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

  public async listMessageAttachments(input: MessageAttachmentListInput) {
    if (input.messageId === mockArchiveFailureMessageId) {
      this.archiveFailureLookups += 1;
      if (this.archiveFailureLookups % 2 === 0) {
        throw new AttachmentDownloadError(
          "provider_failure",
          "Simulated provider archive failure.",
        );
      }
    }
    return listMockMessageAttachments(this.messages, input);
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

  public async sendMessage(input: SendMessageInput) {
    const now = new Date().toISOString();
    const messageId = id.message(`sent-${crypto.randomUUID()}`);
    const attachments = (input.attachments ?? []).map((attachment) => ({
      disposition: "attachment" as const,
      id: id.attachment(`mock-${crypto.randomUUID()}`),
      mimeType: attachment.mimeType,
      name: attachment.name,
      size: attachment.size,
    }));
    this.attachmentContents.set(
      messageId,
      new Map(
        attachments.map((attachment, index) => [
          attachment.id,
          input.attachments?.[index]?.content.slice() ?? new Uint8Array(),
        ]),
      ),
    );
    this.messages.unshift({
      attachments,
      cc: input.cc,
      from: [{ email: "member@example.com", name: "Sample Member" }],
      hasAttachment: attachments.length > 0,
      htmlBody: input.htmlBody ?? null,
      id: messageId,
      isStarred: false,
      isUnread: false,
      mailboxIds: [mockMailboxIds.sent],
      preview: input.body.slice(0, 140),
      receivedAt: now,
      replyTo: [],
      size:
        new TextEncoder().encode(input.body).byteLength +
        new TextEncoder().encode(input.htmlBody ?? "").byteLength +
        attachments.reduce((total, attachment) => total + attachment.size, 0),
      subject: input.subject || "(No subject)",
      textBody: input.body,
      threadId: id.thread(`thread-${messageId}`),
      to: input.to,
    });
    return {
      deliveryStatus: "accepted" as const,
      id: messageId,
      rejectedRecipients: [],
      submittedAt: now,
    };
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
