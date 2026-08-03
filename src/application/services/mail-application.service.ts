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
import type { MailSearchQuery } from "@/domain/mail/mail-search";
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
