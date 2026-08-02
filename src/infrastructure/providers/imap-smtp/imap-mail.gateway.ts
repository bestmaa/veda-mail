import "server-only";

import type { MailGateway } from "@/application/ports/mail-provider.port";
import { DraftConflictError } from "@/domain/mail/draft-errors";
import type { LabelCleanupInput } from "@/domain/mail/label";
import type { MailboxEmptyInput } from "@/domain/mail/mailbox-empty";
import type {
  AttachmentDownload,
  AttachmentDownloadInput,
  MessageAttachmentListInput,
  MessageListQuery,
  MessageMutation,
  MailboxMutation,
  SendMessageInput,
} from "@/domain/mail/mail";
import type {
  MemberPasswordChange,
  MemberProfileUpdate,
  MemberTwoFactorUpdate,
} from "@/domain/member/member-settings";
import type { MessageId, ProviderDraftId } from "@/domain/shared/brand";
import { ImapMailReader } from "@/infrastructure/providers/imap-smtp/imap-mail.reader";
import { ImapMailWriter } from "@/infrastructure/providers/imap-smtp/imap-mail.writer";
import { ImapDraftStore } from "@/infrastructure/providers/imap-smtp/imap-draft.store";
import { withImapDraftOperation } from "@/infrastructure/providers/imap-smtp/imap-draft-operation-lock";
import { ImapMailboxManager } from "@/infrastructure/providers/imap-smtp/imap-mailbox.manager";
import { withImapClient } from "@/infrastructure/providers/imap-smtp/imap-client";
import { cleanupImapLabel } from "@/infrastructure/providers/imap-smtp/imap-label-cleanup";
import { emptyImapMailbox } from "@/infrastructure/providers/imap-smtp/imap-mailbox-empty";
import type { ImapSmtpMemberConfig } from "@/infrastructure/providers/imap-smtp/imap-smtp.types";
import { SmtpAttachmentCapability } from "@/infrastructure/providers/imap-smtp/smtp-attachment-capability";
import { sameDraftContent } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft.mapper";

const unsupported = (feature: string): never => {
  throw new Error(`${feature} is not available through standard IMAP/SMTP.`);
};

export class ImapSmtpMailGateway implements MailGateway {
  private readonly attachmentCapability: SmtpAttachmentCapability;
  private readonly drafts: ImapDraftStore;
  private readonly reader: ImapMailReader;
  private readonly mailboxes: ImapMailboxManager;
  private readonly writer: ImapMailWriter;

  public constructor(private readonly config: ImapSmtpMemberConfig) {
    this.attachmentCapability = new SmtpAttachmentCapability(config);
    this.drafts = new ImapDraftStore(config);
    this.reader = new ImapMailReader(config);
    this.mailboxes = new ImapMailboxManager(config);
    this.writer = new ImapMailWriter(config, this.attachmentCapability);
  }

  public async changePassword(_input: MemberPasswordChange): Promise<void> {
    void _input;
    unsupported("Password changes");
  }

  public cleanupLabel(input: LabelCleanupInput) {
    return withImapClient(this.config, (client) => cleanupImapLabel(
      client,
      input,
      `${this.config.imapHost}\0${this.config.imapPort}\0${this.config.username}\0${this.config.secret}`,
    ));
  }

  public emptyMailbox(input: MailboxEmptyInput, cursorSecret: string) {
    return withImapClient(this.config, (client) => emptyImapMailbox(
      client,
      input,
      cursorSecret,
    ));
  }

  public discardDraft(providerDraftId: ProviderDraftId, expectedRevision: string) {
    return this.drafts.discard(providerDraftId, expectedRevision);
  }

  public getAccount() {
    return this.reader.getAccount();
  }

  public getDraft(providerDraftId: ProviderDraftId) {
    return this.drafts.get(providerDraftId);
  }

  public getDraftCapability() {
    return this.drafts.capability();
  }

  public getLabelCapability(mailboxId: Parameters<ImapMailReader["getLabelCapability"]>[0]) {
    return this.reader.getLabelCapability(mailboxId);
  }

  public downloadAttachment(
    input: AttachmentDownloadInput,
  ): Promise<AttachmentDownload> {
    return this.reader.downloadAttachment(input);
  }

  public getMaxAttachmentBytes() {
    return this.attachmentCapability.getMaxAttachmentBytes();
  }

  public async getMemberProfile() {
    const account = await this.reader.getAccount();
    return { displayName: account.name, email: account.email };
  }

  public async getTwoFactorEnabled() {
    return false;
  }

  public getMessage(messageId: MessageId) {
    return this.reader.getMessage(messageId);
  }

  public listMessageAttachments(input: MessageAttachmentListInput) {
    return this.reader.listMessageAttachments(input);
  }

  public listMailboxes() {
    return this.reader.listMailboxes();
  }

  public listMessages(query: MessageListQuery) {
    return this.reader.listMessages(query);
  }

  public mutateMessage(mutation: MessageMutation) {
    return this.writer.mutateMessage(mutation);
  }

  public mutateMailbox(mutation: MailboxMutation) {
    return this.mailboxes.mutate(mutation);
  }

  public saveDraft(...input: Parameters<ImapDraftStore["save"]>) {
    return this.drafts.save(...input);
  }

  public async sendMessage(input: SendMessageInput) {
    if (!input.providerDraft) return this.writer.sendMessage(input);
    return withImapDraftOperation(
      this.config,
      input.providerDraft.composeId,
      async () => {
        const saved = await this.drafts.prepareSend(input.providerDraft!);
        if (!sameDraftContent(saved.detail.content, input) ||
          (input.attachments?.length ?? 0) > 0) {
          throw new DraftConflictError();
        }
        const savedAttachments = saved.attachments.map(({ outgoing }) => outgoing);
        const receipt = await this.writer.sendMessage(savedAttachments.length > 0
          ? { ...input, attachments: savedAttachments }
          : input);
        if (receipt.deliveryStatus !== "uncertain") {
          await this.drafts
            .discard(saved.detail.id, saved.detail.revision)
            .catch(() => console.error("[veda-mail] Accepted IMAP draft cleanup failed."));
        }
        return receipt;
      },
    );
  }

  public async testConnection(): Promise<void> {
    await this.reader.listMailboxes();
  }

  public async updateMemberProfile(
    _input: MemberProfileUpdate,
  ): Promise<never> {
    void _input;
    return unsupported("Profile changes");
  }

  public async updateTwoFactor(_input: MemberTwoFactorUpdate): Promise<void> {
    void _input;
    unsupported("Provider-managed two-factor authentication");
  }
}
