import "server-only";

import type { MailGateway } from "@/application/ports/mail-provider.port";
import type {
  AttachmentDownloadInput,
  MessageAttachmentListInput,
  MessageListQuery,
  MessageMutation,
  MailboxMutation,
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
import { StalwartMailboxManager } from "@/infrastructure/providers/stalwart-jmap/stalwart-mailbox.manager";
import { StalwartDraftStore } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft.store";
import { DraftHasAttachmentsError } from "@/domain/mail/draft-errors";
import type { LabelCleanupInput } from "@/domain/mail/label";
import type { StalwartConfig } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";
import { cleanupStalwartLabel } from "@/infrastructure/providers/stalwart-jmap/stalwart-label-cleanup";

export class StalwartMailGateway implements MailGateway {
  private readonly accountManager: StalwartAccountManager;
  private readonly client: StalwartJmapClient;
  private readonly drafts: StalwartDraftStore;
  private readonly reader: StalwartMailReader;
  private readonly mailboxes: StalwartMailboxManager;
  private readonly writer: StalwartMailWriter;

  public constructor(private readonly config: StalwartConfig) {
    this.client = new StalwartJmapClient(config);
    this.reader = new StalwartMailReader(this.client, config);
    this.mailboxes = new StalwartMailboxManager(this.client, this.reader);
    this.drafts = new StalwartDraftStore(this.client, this.reader);
    this.writer = new StalwartMailWriter(this.client, this.reader);
    this.accountManager = new StalwartAccountManager(this.client, this.reader);
  }

  public discardDraft(...input: Parameters<StalwartDraftStore["discard"]>) {
    return this.drafts.discard(...input);
  }

  public cleanupLabel(input: LabelCleanupInput) {
    return cleanupStalwartLabel(
      this.client,
      this.reader,
      input,
      `${this.config.baseUrl}\0${this.config.username}\0${this.config.secret}`,
    );
  }

  public changePassword(input: MemberPasswordChange) {
    return this.accountManager.changePassword(input);
  }

  public getAccount() {
    return this.reader.getAccount();
  }

  public getDraft(...input: Parameters<StalwartDraftStore["get"]>) {
    return this.drafts.get(...input);
  }

  public getDraftCapability() {
    return this.drafts.capability();
  }

  public async getLabelCapability() {
    return "supported" as const;
  }

  public downloadAttachment(input: AttachmentDownloadInput) {
    return this.reader.downloadAttachment(input);
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

  public saveDraft(...input: Parameters<StalwartDraftStore["save"]>) {
    return this.drafts.save(...input);
  }

  public async sendMessage(input: SendMessageInput) {
    if (!input.providerDraft) return this.writer.sendMessage(input);
    if ((input.attachments?.length ?? 0) > 0) {
      throw new DraftHasAttachmentsError();
    }
    return this.writer.sendSavedDraft(input, () =>
      this.drafts.prepareSend(input.providerDraft!),
    );
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
