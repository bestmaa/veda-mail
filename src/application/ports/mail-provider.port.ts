import type {
  AttachmentDownload,
  AttachmentDownloadInput,
  MailAccount,
  Mailbox,
  MessageDetail,
  MessageAttachmentMetadata,
  MessageAttachmentListInput,
  MessageListQuery,
  MessageMutation,
  MessagePage,
  SendReceipt,
  SendMessageInput,
} from "@/domain/mail/mail";
import type {
  DraftCapability,
  DraftDetail,
  DraftSaveInput,
} from "@/domain/mail/draft";
import type {
  MemberAuthenticationResult,
  MemberCredentials,
  ProviderConnection,
  ProviderManifest,
} from "@/domain/provider/provider";
import type {
  MemberPasswordChange,
  MemberProfile,
  MemberProfileUpdate,
  MemberTwoFactorUpdate,
} from "@/domain/member/member-settings";
import type { MessageId, ProviderDraftId } from "@/domain/shared/brand";

export interface MailGateway {
  changePassword(input: MemberPasswordChange): Promise<void>;
  discardDraft(
    providerDraftId: ProviderDraftId,
    expectedRevision: string,
  ): Promise<void>;
  downloadAttachment(
    input: AttachmentDownloadInput,
  ): Promise<AttachmentDownload>;
  getMaxAttachmentBytes(): Promise<number>;
  getAccount(): Promise<MailAccount>;
  getDraft(providerDraftId: ProviderDraftId): Promise<DraftDetail>;
  getDraftCapability(): Promise<DraftCapability>;
  getMemberProfile(): Promise<MemberProfile>;
  getTwoFactorEnabled(): Promise<boolean>;
  getMessage(messageId: MessageId): Promise<MessageDetail>;
  listMessageAttachments(
    input: MessageAttachmentListInput,
  ): Promise<readonly MessageAttachmentMetadata[]>;
  listMailboxes(): Promise<readonly Mailbox[]>;
  listMessages(query: MessageListQuery): Promise<MessagePage>;
  mutateMessage(mutation: MessageMutation): Promise<void>;
  saveDraft(input: DraftSaveInput): Promise<DraftDetail>;
  sendMessage(input: SendMessageInput): Promise<SendReceipt>;
  testConnection(): Promise<void>;
  updateTwoFactor(input: MemberTwoFactorUpdate): Promise<void>;
  updateMemberProfile(input: MemberProfileUpdate): Promise<MemberProfile>;
}

export interface ProviderModule {
  readonly manifest: ProviderManifest;
  authenticateMember(
    serviceConfig: Readonly<Record<string, string>>,
    credentials: MemberCredentials,
  ): Promise<MemberAuthenticationResult>;
  createGateway(connection: ProviderConnection): Promise<MailGateway>;
  createMemberConfig(
    serviceConfig: Readonly<Record<string, string>>,
    credentials: MemberCredentials,
  ): Readonly<Record<string, string>>;
  parseServiceConfig(
    input: Readonly<Record<string, string>>,
  ): Readonly<Record<string, string>>;
  rotateMemberSecret(
    config: Readonly<Record<string, string>>,
    newPassword: string,
  ): Readonly<Record<string, string>>;
  validateServiceConfig(
    input: Readonly<Record<string, string>>,
  ): Promise<Readonly<Record<string, string>>>;
}
