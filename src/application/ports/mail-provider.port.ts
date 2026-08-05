import type {
  AttachmentDownload,
  AttachmentDownloadInput,
  MailAccount,
  Mailbox,
  MailboxMutation,
  MailboxMutationResult,
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
  ConversationPage,
  ConversationQuery,
} from "@/domain/mail/conversation";
import type {
  CalendarPart,
  CalendarPartDownload,
  CalendarPartDownloadInput,
  CalendarPartListInput,
} from "@/domain/mail/calendar";
import type {
  DraftCapability,
  DraftDetail,
  DraftSaveInput,
} from "@/domain/mail/draft";
import type {
  LabelCapability,
  LabelCleanupInput,
  LabelCleanupResult,
} from "@/domain/mail/label";
import type {
  RuleCapability,
  RuleDeploymentInput,
  RuleDeploymentResult,
  RulePreviewInput,
  RulePreviewResult,
} from "@/domain/mail/rule";
import type {
  SnoozeCapability,
  SnoozeOwnedMailbox,
  SnoozePreflightInput,
  SnoozePreflightResult,
  SnoozeProviderInspection,
  SnoozeProviderOperationResult,
  SnoozeProviderPlan,
} from "@/domain/mail/snooze";
import type { MailUpdateWaitResult } from "@/domain/mail/mail-update";
import type { MailUpdateMode } from "@/domain/mail/mail-update";
import type {
  MailboxEmptyInput,
  MailboxEmptyResult,
} from "@/domain/mail/mailbox-empty";
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
import type { MailboxId, MessageId, ProviderDraftId } from "@/domain/shared/brand";

export interface MailGateway {
  changePassword(input: MemberPasswordChange): Promise<void>;
  cleanupLabel(input: LabelCleanupInput): Promise<LabelCleanupResult>;
  emptyMailbox(
    input: MailboxEmptyInput,
    cursorSecret: string,
  ): Promise<MailboxEmptyResult>;
  discardDraft(
    providerDraftId: ProviderDraftId,
    expectedRevision: string,
  ): Promise<void>;
  downloadAttachment(
    input: AttachmentDownloadInput,
  ): Promise<AttachmentDownload>;
  downloadCalendarPart(
    input: CalendarPartDownloadInput,
  ): Promise<CalendarPartDownload>;
  getMaxAttachmentBytes(): Promise<number>;
  getAccount(): Promise<MailAccount>;
  getDraft(providerDraftId: ProviderDraftId): Promise<DraftDetail>;
  getDraftCapability(): Promise<DraftCapability>;
  getLabelCapability(mailboxId: MailboxId): Promise<LabelCapability>;
  getMemberProfile(): Promise<MemberProfile>;
  getMailUpdateMode(): Promise<MailUpdateMode>;
  getRuleCapability(): Promise<RuleCapability>;
  getSnoozeAccountScope(): Promise<string>;
  getSnoozeCapability(): Promise<SnoozeCapability>;
  getTwoFactorEnabled(): Promise<boolean>;
  getMessage(messageId: MessageId): Promise<MessageDetail>;
  getConversation(query: ConversationQuery): Promise<ConversationPage>;
  listMessageAttachments(
    input: MessageAttachmentListInput,
  ): Promise<readonly MessageAttachmentMetadata[]>;
  listCalendarParts(
    input: CalendarPartListInput,
  ): Promise<readonly CalendarPart[]>;
  listMailboxes(): Promise<readonly Mailbox[]>;
  listMessages(query: MessageListQuery): Promise<MessagePage>;
  waitForMailUpdate(signal?: AbortSignal): Promise<MailUpdateWaitResult>;
  mutateMessage(mutation: MessageMutation): Promise<void>;
  mutateMailbox(mutation: MailboxMutation): Promise<MailboxMutationResult>;
  deployRules(input: RuleDeploymentInput): Promise<RuleDeploymentResult>;
  previewRules(input: RulePreviewInput): Promise<readonly RulePreviewResult[]>;
  snoozeMailboxIntent(): Promise<SnoozeOwnedMailbox>;
  preflightSnooze(input: SnoozePreflightInput): Promise<SnoozePreflightResult>;
  inspectSnooze(plan: SnoozeProviderPlan): Promise<SnoozeProviderInspection>;
  hideSnooze(plan: SnoozeProviderPlan): Promise<SnoozeProviderOperationResult>;
  restoreSnooze(plan: SnoozeProviderPlan): Promise<SnoozeProviderOperationResult>;
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
