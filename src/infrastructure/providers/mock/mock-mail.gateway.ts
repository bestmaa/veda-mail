import "server-only";
import { createHash } from "node:crypto";
import type { MailGateway } from "@/application/ports/mail-provider.port";
import type {
  AttachmentDownloadInput,
  Mailbox,
  MailboxMutation,
  MessageDetail,
  MessageAttachmentListInput,
  MessageListQuery,
  MessageMutation,
  SendMessageInput,
} from "@/domain/mail/mail";
import type { LabelCleanupInput } from "@/domain/mail/label";
import type { ConversationQuery } from "@/domain/mail/conversation";
import type { CalendarPartDownloadInput } from "@/domain/mail/calendar";
import type { MailboxEmptyInput } from "@/domain/mail/mailbox-empty";
import type { RuleDeploymentInput, RulePreviewInput } from "@/domain/mail/rule";
import type { SnoozePreflightInput, SnoozeProviderPlan } from "@/domain/mail/snooze"; // provider DTOs
import { id, type MessageId } from "@/domain/shared/brand";
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
import { MockDraftStore } from "@/infrastructure/providers/mock/mock-draft.store";
import { MockMailboxStore } from "@/infrastructure/providers/mock/mock-mailbox.store";
import { cleanupMockLabel } from "@/infrastructure/providers/mock/mock-label-cleanup";
import { emptyMockMailbox } from "@/infrastructure/providers/mock/mock-mailbox-empty";
import { listMockMessages } from "@/infrastructure/providers/mock/mock-message-list";
import { readMockConversation } from "@/infrastructure/providers/mock/mock-conversation";
import {
  deployMockRules,
  mockRuleCapability,
  previewMockRules,
} from "@/infrastructure/providers/mock/mock-rule-preview";
import {
  hideMockSnooze,
  inspectMockSnooze,
  mockSnoozeMailbox,
  preflightMockSnooze,
  restoreMockSnooze,
} from "@/infrastructure/providers/mock/mock-snooze-adapter";
export class MockMailGateway implements MailGateway {
  public async getMailUpdateMode() { return "poll" as const; } public async waitForMailUpdate() { return { mode: "poll" as const, retryAfterMs: 60_000, shouldRefresh: true }; }
  private readonly attachmentContents = createMockAttachmentContents();
  private readonly drafts = new MockDraftStore();
  private readonly mailboxes = new MockMailboxStore();
  public readonly discardDraft = this.drafts.discard.bind(this.drafts);
  public readonly getDraft = this.drafts.get.bind(this.drafts); public readonly getDraftCapability = this.drafts.capability.bind(this.drafts);
  public async getLabelCapability() { return "supported" as const; } public async getRuleCapability() { return mockRuleCapability(); }
  public deployRules(input: RuleDeploymentInput): Promise<never> {
    return deployMockRules(input); }
  public async previewRules(input: RulePreviewInput) {
    return previewMockRules(this.messages, input);
  }
  public async getSnoozeCapability() { return {
    maxMessages: 100, snoozedMailboxId: mockMailboxIds.snoozed,
    supported: true } as const; }
  public async getSnoozeAccountScope() {
    return createHash("sha256").update("veda-mail/mock-account").digest("base64url"); }
  public async snoozeMailboxIntent() { return mockSnoozeMailbox(); }
  public async preflightSnooze(input: SnoozePreflightInput) {
    return preflightMockSnooze(this.messages, input); }
  public async inspectSnooze(plan: SnoozeProviderPlan) {
    if (plan.kind !== "jmap") throw new Error("Snooze provider mismatch.");
    return inspectMockSnooze(this.messages, plan); }
  public async hideSnooze(plan: SnoozeProviderPlan) {
    if (plan.kind !== "jmap") throw new Error("Snooze provider mismatch.");
    return hideMockSnooze(this.messages, plan); }
  public async restoreSnooze(plan: SnoozeProviderPlan) {
    if (plan.kind !== "jmap") throw new Error("Snooze provider mismatch.");
    return restoreMockSnooze(this.messages, plan); }
  public readonly saveDraft = this.drafts.save.bind(this.drafts);
  private archiveFailureLookups = 0;
  private messages = createMockMessages();
  private profile = { displayName: "Sample Member", email: "member@example.com" };
  public async changePassword(input: MemberPasswordChange): Promise<void> { void input; }
  public async cleanupLabel(input: LabelCleanupInput) {
    return cleanupMockLabel(this.messages, input); }
  public async emptyMailbox(input: MailboxEmptyInput, cursorSecret: string) {
    void cursorSecret; return emptyMockMailbox(this.messages, input);
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
  public async downloadCalendarPart(input: CalendarPartDownloadInput): Promise<never> {
    void input;
    throw new AttachmentDownloadError("not_found", "Calendar invitation not found.");
  }
  public async getAccount() {
    return {
      email: "member@example.com",
      id: id.account("mock-account"),
      name: "Sample Member",
      providerId: id.provider("mock"),
    };
  }
  public async getMaxAttachmentBytes() { return 18 * 1024 * 1024; }
  public async getMemberProfile() { return this.profile; }
  public async getTwoFactorEnabled() { return false; }
  public async getMessage(messageId: MessageId): Promise<MessageDetail> {
    const message = this.messages.find((item) => item.id === messageId);
    if (!message) throw new Error("Message not found.");
    return structuredClone(message);
  }
  public async getConversation(query: ConversationQuery) {
    return readMockConversation(this.messages, query); }
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
  public async listCalendarParts() { return []; }
  public async listMailboxes(): Promise<readonly Mailbox[]> {
    return this.mailboxes.list([...this.messages, ...this.drafts.messages()]);
  }
  public async listMessages(query: MessageListQuery) {
    return listMockMessages(
      [...this.messages, ...this.drafts.messages()],
      query,
    );
  }
  public async mutateMessage(mutation: MessageMutation): Promise<void> {
    const index = this.messages.findIndex(
      (message) => message.id === mutation.messageId,
    );
    const current = this.messages[index];
    if (!current) throw new Error("Message not found.");
    if (mutation.type === "destroy") { this.messages.splice(index, 1); return; }
    if (mutation.type === "set-read") {
      this.messages[index] = { ...current, isUnread: !mutation.value };
      return;
    }
    if (mutation.type === "set-starred") {
      this.messages[index] = { ...current, isStarred: mutation.value };
      return;
    }
    if (mutation.type === "set-label") {
      const labels = new Set(current.labelIds);
      if (mutation.value) labels.add(mutation.labelId);
      else labels.delete(mutation.labelId);
      this.messages[index] = { ...current, labelIds: [...labels] };
      return;
    }
    let nextMailbox = mockMailboxIds.inbox;
    if (mutation.type === "archive") nextMailbox = mockMailboxIds.archive;
    else if (mutation.type === "delete") nextMailbox = mockMailboxIds.trash;
    else if (mutation.type === "move") {
      if (!current.mailboxIds.includes(mutation.sourceMailboxId)) {
        throw new Error("The message is outside the selected source mailbox.");
      }
      nextMailbox = mutation.destinationMailboxId;
    }
    this.messages[index] = { ...current, mailboxIds: [nextMailbox] };
  }
  public async mutateMailbox(mutation: MailboxMutation) {
    return this.mailboxes.mutate(
      mutation,
      [...this.messages, ...this.drafts.messages()],
    );
  }
  public async sendMessage(input: SendMessageInput) {
    const savedAttachments = this.drafts.consumeForSend(
      input.providerDraft,
      (input.attachments?.length ?? 0) > 0,
    );
    const outgoingAttachments = [
      ...savedAttachments,
      ...(input.attachments ?? []),
    ];
    const now = new Date().toISOString();
    const messageId = id.message(`sent-${crypto.randomUUID()}`);
    const attachments = outgoingAttachments.map((attachment) => ({
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
          outgoingAttachments[index]?.content.slice() ?? new Uint8Array(),
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
      labelIds: [],
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
  public async updateTwoFactor(input: MemberTwoFactorUpdate): Promise<void> { void input; }
  public async updateMemberProfile(input: MemberProfileUpdate) {
    this.profile = { ...this.profile, displayName: input.displayName };
    return this.profile; }
}
