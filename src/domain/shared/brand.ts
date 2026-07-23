declare const brand: unique symbol;

export type Brand<TValue, TName extends string> = TValue & {
  readonly [brand]: TName;
};

export type AccountId = Brand<string, "AccountId">;
export type ConnectionId = Brand<string, "ConnectionId">;
export type MailboxId = Brand<string, "MailboxId">;
export type MessageId = Brand<string, "MessageId">;
export type ProviderId = Brand<string, "ProviderId">;
export type ThreadId = Brand<string, "ThreadId">;

export const id = {
  account: (value: string) => value as AccountId,
  connection: (value: string) => value as ConnectionId,
  mailbox: (value: string) => value as MailboxId,
  message: (value: string) => value as MessageId,
  provider: (value: string) => value as ProviderId,
  thread: (value: string) => value as ThreadId,
};
