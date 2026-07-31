declare const brand: unique symbol;

export type Brand<TValue, TName extends string> = TValue & {
  readonly [brand]: TName;
};

export type AccountId = Brand<string, "AccountId">;
export type AttachmentId = Brand<string, "AttachmentId">;
export type AttachmentUploadId = Brand<string, "AttachmentUploadId">;
export type ConnectionId = Brand<string, "ConnectionId">;
export type DraftId = Brand<string, "DraftId">;
export type MailboxId = Brand<string, "MailboxId">;
export type MessageId = Brand<string, "MessageId">;
export type ProviderId = Brand<string, "ProviderId">;
export type SignatureId = Brand<string, "SignatureId">;
export type ThreadId = Brand<string, "ThreadId">;

export const id = {
  account: (value: string) => value as AccountId,
  attachment: (value: string) => value as AttachmentId,
  attachmentUpload: (value: string) => value as AttachmentUploadId,
  connection: (value: string) => value as ConnectionId,
  draft: (value: string) => value as DraftId,
  mailbox: (value: string) => value as MailboxId,
  message: (value: string) => value as MessageId,
  provider: (value: string) => value as ProviderId,
  signature: (value: string) => value as SignatureId,
  thread: (value: string) => value as ThreadId,
};
