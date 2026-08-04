import type { MailGateway } from "@/application/ports/mail-provider.port";
import type { DraftSaveInput } from "@/domain/mail/draft";
import type { LabelCleanupInput } from "@/domain/mail/label";
import type { MailboxEmptyInput } from "@/domain/mail/mailbox-empty";
import type {
  AttachmentDownloadInput,
  Mailbox,
  MailboxMutation,
  MessageAttachmentListInput,
  MessageMutation,
  ProviderMailWorkspace,
  SendMessageInput,
} from "@/domain/mail/mail";
import type { MessageListSort } from "@/domain/mail/message-list-preferences";
import type { ConversationQuery } from "@/domain/mail/conversation";
import type {
  CalendarPartDownloadInput,
  CalendarPartListInput,
} from "@/domain/mail/calendar";
import type { MailSearchQuery } from "@/domain/mail/mail-search";
import type { RuleDeploymentInput, RulePreviewInput } from "@/domain/mail/rule";
import type { SnoozePreflightInput, SnoozeProviderPlan } from "@/domain/mail/snooze";
import type {
  MailboxId,
  MessageId,
  ProviderDraftId,
} from "@/domain/shared/brand";

export interface WorkspaceQuery {
  readonly cursor?: string;
  readonly includePreview: boolean;
  readonly limit: number;
  readonly mailboxId?: MailboxId;
  readonly search?: MailSearchQuery;
  readonly sort: MessageListSort;
}

export class MailApplicationService {
  public constructor(private readonly gateway: MailGateway) {}

  public async getWorkspace(
    query: WorkspaceQuery,
    knownMailboxes?: readonly Mailbox[],
  ): Promise<ProviderMailWorkspace> {
    const mailboxes = knownMailboxes ?? await this.gateway.listMailboxes();
    const mailboxId = query.mailboxId ?? this.getDefaultMailbox(mailboxes).id;
    const [account, draftCapability, labelCapability, messages] = await Promise.all([
      this.gateway.getAccount(),
      this.gateway.getDraftCapability(),
      this.gateway.getLabelCapability(mailboxId),
      this.gateway.listMessages({ ...query, mailboxId }),
    ]);

    return { account, draftCapability, labelCapability, mailboxes, messages };
  }

  public getMessage(messageId: MessageId) {
    return this.gateway.getMessage(messageId);
  }

  public getConversation(query: ConversationQuery) {
    return this.gateway.getConversation(query);
  }

  public cleanupLabel(input: LabelCleanupInput) {
    return this.gateway.cleanupLabel(input);
  }

  public emptyMailbox(input: MailboxEmptyInput, cursorSecret: string) {
    return this.gateway.emptyMailbox(input, cursorSecret);
  }

  public getAccount() {
    return this.gateway.getAccount();
  }

  public listMailboxes() {
    return this.gateway.listMailboxes();
  }

  public mutateMailbox(mutation: MailboxMutation) {
    return this.gateway.mutateMailbox(mutation);
  }

  public listMessageAttachments(input: MessageAttachmentListInput) {
    return this.gateway.listMessageAttachments(input);
  }

  public downloadAttachment(input: AttachmentDownloadInput) {
    return this.gateway.downloadAttachment(input);
  }

  public listCalendarParts(input: CalendarPartListInput) {
    return this.gateway.listCalendarParts(input);
  }

  public downloadCalendarPart(input: CalendarPartDownloadInput) {
    return this.gateway.downloadCalendarPart(input);
  }

  public discardDraft(
    providerDraftId: ProviderDraftId,
    expectedRevision: string,
  ) {
    return this.gateway.discardDraft(providerDraftId, expectedRevision);
  }

  public getDraft(providerDraftId: ProviderDraftId) {
    return this.gateway.getDraft(providerDraftId);
  }

  public getDraftCapability() {
    return this.gateway.getDraftCapability();
  }

  public getMaxAttachmentBytes() {
    return this.gateway.getMaxAttachmentBytes();
  }

  public getRuleCapability() {
    return this.gateway.getRuleCapability();
  }

  public deployRules(input: RuleDeploymentInput) {
    return this.gateway.deployRules(input);
  }

  public previewRules(input: RulePreviewInput) {
    return this.gateway.previewRules(input);
  }

  public getSnoozeAccountScope() { return this.gateway.getSnoozeAccountScope(); }
  public getSnoozeCapability() { return this.gateway.getSnoozeCapability(); }
  public snoozeMailboxIntent() { return this.gateway.snoozeMailboxIntent(); }
  public preflightSnooze(input: SnoozePreflightInput) {
    return this.gateway.preflightSnooze(input);
  }
  public inspectSnooze(plan: SnoozeProviderPlan) {
    return this.gateway.inspectSnooze(plan);
  }
  public hideSnooze(plan: SnoozeProviderPlan) {
    return this.gateway.hideSnooze(plan);
  }
  public restoreSnooze(plan: SnoozeProviderPlan) {
    return this.gateway.restoreSnooze(plan);
  }

  public mutateMessage(mutation: MessageMutation) {
    return this.gateway.mutateMessage(mutation);
  }

  public saveDraft(input: DraftSaveInput) {
    return this.gateway.saveDraft(input);
  }

  public sendMessage(input: SendMessageInput) {
    return this.gateway.sendMessage(input);
  }

  private getDefaultMailbox(mailboxes: readonly Mailbox[]): Mailbox {
    const mailbox =
      mailboxes.find((candidate) => candidate.role === "inbox") ?? mailboxes[0];
    if (!mailbox) {
      throw new Error("The account does not contain any mailboxes.");
    }
    return mailbox;
  }
}
