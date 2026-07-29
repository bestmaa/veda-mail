import "server-only";

import type { MailGateway } from "@/application/ports/mail-provider.port";
import type {
  MessageListQuery,
  MessageMutation,
  SendMessageInput,
} from "@/domain/mail/mail";
import type { MessageId } from "@/domain/shared/brand";
import type {
  MemberPasswordChange,
  MemberProfileUpdate,
  MemberTwoFactorUpdate,
} from "@/domain/member/member-settings";
import { StalwartAccountManager } from "@/infrastructure/providers/stalwart-jmap/stalwart-account-manager";
import { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import { maximumJmapUploadBytes } from "@/infrastructure/providers/stalwart-jmap/jmap-outgoing-attachment";
import { StalwartMailReader } from "@/infrastructure/providers/stalwart-jmap/stalwart-mail.reader";
import { StalwartMailWriter } from "@/infrastructure/providers/stalwart-jmap/stalwart-mail.writer";
import type { StalwartConfig } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

export class StalwartMailGateway implements MailGateway {
  private readonly accountManager: StalwartAccountManager;
  private readonly client: StalwartJmapClient;
  private readonly reader: StalwartMailReader;
  private readonly writer: StalwartMailWriter;

  public constructor(config: StalwartConfig) {
    this.client = new StalwartJmapClient(config);
    this.reader = new StalwartMailReader(this.client, config);
    this.writer = new StalwartMailWriter(this.client, this.reader);
    this.accountManager = new StalwartAccountManager(this.client, this.reader);
  }

  public changePassword(input: MemberPasswordChange) {
    return this.accountManager.changePassword(input);
  }

  public getAccount() {
    return this.reader.getAccount();
  }

  public async getMaxAttachmentBytes() {
    return maximumJmapUploadBytes(await this.client.getSession());
  }

  public getMemberProfile() {
    return this.accountManager.getProfile();
  }

  public getTwoFactorEnabled() {
    return this.accountManager.getTwoFactorEnabled();
  }

  public getMessage(messageId: MessageId) {
    return this.reader.getMessage(messageId);
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

  public sendMessage(input: SendMessageInput) {
    return this.writer.sendMessage(input);
  }

  public async testConnection(): Promise<void> {
    await this.reader.listMailboxes();
  }

  public updateMemberProfile(input: MemberProfileUpdate) {
    return this.accountManager.updateProfile(input);
  }

  public updateTwoFactor(input: MemberTwoFactorUpdate) {
    return this.accountManager.updateTwoFactor(input);
  }
}
