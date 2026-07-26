import type {
  ComposeInput,
  MailAccount,
  Mailbox,
  MessageDetail,
  MessageListQuery,
  MessageMutation,
  MessagePage,
  SendReceipt,
} from "@/domain/mail/mail";
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
import type { MessageId } from "@/domain/shared/brand";

export interface MailGateway {
  changePassword(input: MemberPasswordChange): Promise<void>;
  getAccount(): Promise<MailAccount>;
  getMemberProfile(): Promise<MemberProfile>;
  getTwoFactorEnabled(): Promise<boolean>;
  getMessage(messageId: MessageId): Promise<MessageDetail>;
  listMailboxes(): Promise<readonly Mailbox[]>;
  listMessages(query: MessageListQuery): Promise<MessagePage>;
  mutateMessage(mutation: MessageMutation): Promise<void>;
  sendMessage(input: ComposeInput): Promise<SendReceipt>;
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
