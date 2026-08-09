declare const brand: unique symbol;

export type Brand<TValue, TName extends string> = TValue & {
  readonly [brand]: TName;
};

export type AccountId = Brand<string, "AccountId">;
export type AttachmentId = Brand<string, "AttachmentId">;
export type AttachmentUploadId = Brand<string, "AttachmentUploadId">;
export type ConnectionId = Brand<string, "ConnectionId">;
export type ContactGroupId = Brand<string, "ContactGroupId">;
export type ContactId = Brand<string, "ContactId">;
export type DraftId = Brand<string, "DraftId">;
export type LabelId = Brand<string, "LabelId">;
export type ProviderDraftId = Brand<string, "ProviderDraftId">;
export type MailboxId = Brand<string, "MailboxId">;
export type MessageId = Brand<string, "MessageId">;
export type ProviderId = Brand<string, "ProviderId">;
export type ScheduledMessageId = Brand<string, "ScheduledMessageId">;
export type SavedSearchId = Brand<string, "SavedSearchId">;
export type SignatureId = Brand<string, "SignatureId">;
export type TemplateId = Brand<string, "TemplateId">;
export type ThreadId = Brand<string, "ThreadId">;

export const id = {
  account: (value: string) => value as AccountId,
  attachment: (value: string) => value as AttachmentId,
  attachmentUpload: (value: string) => value as AttachmentUploadId,
  connection: (value: string) => value as ConnectionId,
  contact: (value: string) => value as ContactId,
  contactGroup: (value: string) => value as ContactGroupId,
  draft: (value: string) => value as DraftId,
  label: (value: string) => value as LabelId,
  providerDraft: (value: string) => value as ProviderDraftId,
  mailbox: (value: string) => value as MailboxId,
  message: (value: string) => value as MessageId,
  provider: (value: string) => value as ProviderId,
  scheduledMessage: (value: string) => value as ScheduledMessageId,
  savedSearch: (value: string) => value as SavedSearchId,
  signature: (value: string) => value as SignatureId,
  template: (value: string) => value as TemplateId,
  thread: (value: string) => value as ThreadId,
};
