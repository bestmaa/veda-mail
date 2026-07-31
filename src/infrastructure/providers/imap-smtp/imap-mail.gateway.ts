import "server-only";

import type { MailGateway } from "@/application/ports/mail-provider.port";
import type { DraftSaveInput } from "@/domain/mail/draft";
import type {
  AttachmentDownload,
  AttachmentDownloadInput,
  MessageAttachmentListInput,
  MessageListQuery,
  MessageMutation,
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
import type { ImapSmtpMemberConfig } from "@/infrastructure/providers/imap-smtp/imap-smtp.types";
import { SmtpAttachmentCapability } from "@/infrastructure/providers/imap-smtp/smtp-attachment-capability";

const unsupported = (feature: string): never => {
  throw new Error(`${feature} is not available through standard IMAP/SMTP.`);
};

export class ImapSmtpMailGateway implements MailGateway {
  private readonly attachmentCapability: SmtpAttachmentCapability;
  private readonly reader: ImapMailReader;
  private readonly writer: ImapMailWriter;

  public constructor(config: ImapSmtpMemberConfig) {
    this.attachmentCapability = new SmtpAttachmentCapability(config);
    this.reader = new ImapMailReader(config);
    this.writer = new ImapMailWriter(config, this.attachmentCapability);
  }

  public async changePassword(_input: MemberPasswordChange): Promise<void> {
    void _input;
    unsupported("Password changes");
  }

  public async discardDraft(
    _providerDraftId: ProviderDraftId,
    _expectedRevision: string,
  ): Promise<void> {
    void _providerDraftId;
    void _expectedRevision;
    unsupported("Provider-backed drafts");
  }

  public getAccount() {
    return this.reader.getAccount();
  }

  public async getDraft(_providerDraftId: ProviderDraftId): Promise<never> {
    void _providerDraftId;
    return unsupported("Provider-backed drafts");
  }

  public async getDraftCapability() {
    return { status: "unsupported" as const };
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

  public async saveDraft(_input: DraftSaveInput): Promise<never> {
    void _input;
    return unsupported("Provider-backed drafts");
  }

  public sendMessage(input: SendMessageInput) {
    return this.writer.sendMessage(input);
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
