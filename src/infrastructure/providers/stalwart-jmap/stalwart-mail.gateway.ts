import "server-only";
import { createHash } from "node:crypto";

import type { MailGateway } from "@/application/ports/mail-provider.port";
import type { ConversationQuery } from "@/domain/mail/conversation";
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
import type { MailboxEmptyInput } from "@/domain/mail/mailbox-empty";
import type { RuleDeploymentInput, RulePreviewInput } from "@/domain/mail/rule";
import type { SnoozePreflightInput, SnoozeProviderPlan } from "@/domain/mail/snooze";
import type { StalwartConfig } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";
import { cleanupStalwartLabel } from "@/infrastructure/providers/stalwart-jmap/stalwart-label-cleanup";
import { emptyStalwartMailbox } from "@/infrastructure/providers/stalwart-jmap/stalwart-mailbox-empty";
import {
  downloadStalwartCalendarPart,
  listStalwartCalendarParts,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-calendar.reader";
import { createOwnedSieveCompiler } from "@/infrastructure/providers/sieve/sieve-owned-compiler";
import { sieveDeliveryMailboxNames } from "@/infrastructure/providers/sieve/sieve-mailbox-names";
import { StalwartRuleAdapter } from "@/infrastructure/providers/stalwart-jmap/stalwart-rule-adapter";
import { StalwartSieveTransport } from "@/infrastructure/providers/stalwart-jmap/stalwart-sieve-transport";
import { previewStalwartRules } from "@/infrastructure/providers/stalwart-jmap/stalwart-rule-preview";
import { StalwartSnoozeAdapter } from "@/infrastructure/providers/stalwart-jmap/stalwart-snooze-adapter";
import { StalwartVacationAdapter } from "@/infrastructure/providers/stalwart-jmap/stalwart-vacation-adapter";
import type { VacationResponseUpdate } from "@/domain/mail/vacation";
import {
  getStalwartMailUpdateMode,
  waitForStalwartMailUpdate,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-mail-update";

export class StalwartMailGateway implements MailGateway {
  private readonly accountManager: StalwartAccountManager;
  private readonly client: StalwartJmapClient;
  private readonly drafts: StalwartDraftStore;
  private readonly reader: StalwartMailReader;
  private readonly mailboxes: StalwartMailboxManager;
  private readonly writer: StalwartMailWriter;
  private readonly snooze: StalwartSnoozeAdapter;
  private readonly vacation: StalwartVacationAdapter;

  public constructor(private readonly config: StalwartConfig) {
    this.client = new StalwartJmapClient(config);
    this.reader = new StalwartMailReader(this.client, config);
    this.mailboxes = new StalwartMailboxManager(this.client, this.reader);
    this.drafts = new StalwartDraftStore(this.client, this.reader);
    this.writer = new StalwartMailWriter(this.client, this.reader);
    this.accountManager = new StalwartAccountManager(this.client, this.reader);
    this.snooze = new StalwartSnoozeAdapter(this.client, this.reader);
    this.vacation = new StalwartVacationAdapter(this.client);
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

  public emptyMailbox(input: MailboxEmptyInput, cursorSecret: string) {
    return emptyStalwartMailbox(
      this.client,
      this.reader,
      input,
      cursorSecret,
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

  public getRuleCapability() {
    return this.ruleAdapter({}).getCapability();
  }

  public getSnoozeCapability() { return this.snooze.getCapability(); }
  public getVacationCapability() { return this.vacation.getCapability(); }
  public getVacationResponse() { return this.vacation.get(); }
  public updateVacationResponse(input: VacationResponseUpdate) {
    return this.vacation.set(input); }
  public async getSnoozeAccountScope() {
    const origin = new URL(this.config.baseUrl).origin.toLowerCase();
    const accountId = await this.reader.getAccountId();
    return createHash("sha256").update(JSON.stringify([origin, accountId]))
      .digest("base64url");
  }
  public snoozeMailboxIntent() { return this.snooze.mailboxIntent(); }
  public preflightSnooze(input: SnoozePreflightInput) {
    return this.snooze.preflight(input);
  }
  public inspectSnooze(plan: SnoozeProviderPlan) {
    if (plan.kind !== "jmap") throw new Error("Snooze provider mismatch.");
    return this.snooze.inspect(plan);
  }
  public hideSnooze(plan: SnoozeProviderPlan) {
    if (plan.kind !== "jmap") throw new Error("Snooze provider mismatch.");
    return this.snooze.hide(plan);
  }
  public restoreSnooze(plan: SnoozeProviderPlan) {
    if (plan.kind !== "jmap") throw new Error("Snooze provider mismatch.");
    return this.snooze.restore(plan);
  }

  public downloadAttachment(input: AttachmentDownloadInput) {
    return this.reader.downloadAttachment(input);
  }

  public async downloadCalendarPart(
    input: Parameters<typeof downloadStalwartCalendarPart>[2],
  ) {
    return downloadStalwartCalendarPart(
      this.client, await this.reader.getAccountId(), input,
    );
  }

  public async getMaxAttachmentBytes() {
    return maximumJmapUploadBytes(await this.client.getSession());
  }

  public getMemberProfile() {
    return this.accountManager.getProfile();
  }

  public getMailUpdateMode() { return getStalwartMailUpdateMode(
    this.client, this.config.baseUrl); }

  public getTwoFactorEnabled() {
    return this.accountManager.getTwoFactorEnabled();
  }

  public getMessage(messageId: MessageId) {
    return this.reader.getMessage(messageId);
  }

  public getConversation(query: ConversationQuery) {
    return this.reader.getConversation(query);
  }

  public listMessageAttachments(input: MessageAttachmentListInput) {
    return this.reader.listMessageAttachments(input);
  }

  public waitForMailUpdate() { return waitForStalwartMailUpdate(
    this.client, this.config.baseUrl); }

  public async listCalendarParts(
    input: Parameters<typeof listStalwartCalendarParts>[2],
  ) {
    return listStalwartCalendarParts(
      this.client, await this.reader.getAccountId(), input,
    );
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

  public async deployRules(input: RuleDeploymentInput) {
    const mailboxes = await this.reader.listMailboxes();
    return this.ruleAdapter(sieveDeliveryMailboxNames(mailboxes)).deploy(input);
  }

  public previewRules(input: RulePreviewInput) {
    return previewStalwartRules(this.client, input);
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

  public async testConnection(): Promise<void> { await this.reader.listMailboxes(); }
  public updateMemberProfile(input: MemberProfileUpdate) {
    return this.accountManager.updateProfile(input); }
  public updateTwoFactor(input: MemberTwoFactorUpdate) {
    return this.accountManager.updateTwoFactor(input); }

  private ruleAdapter(mailboxNames: Readonly<Record<string, string>>) {
    return new StalwartRuleAdapter(
      this.client,
      new StalwartSieveTransport(this.client, this.config),
      createOwnedSieveCompiler(mailboxNames),
    );
  }
}
