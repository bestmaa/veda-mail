export type MailUpdateMode = "poll" | "push";

export interface MailUpdateWaitResult {
  readonly mode: MailUpdateMode;
  readonly retryAfterMs: number;
  readonly shouldRefresh: boolean;
}
