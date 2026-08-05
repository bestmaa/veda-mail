export type MailConnectivityPhase =
  | "current"
  | "offline"
  | "reconnecting"
  | "restored"
  | "stale";

export interface MailConnectivityViewModel {
  readonly canRetry: boolean;
  readonly isBusy: boolean;
  readonly message: string;
  readonly onRetry: () => void;
  readonly phase: Exclude<MailConnectivityPhase, "current"> | null;
}

export const nextConnectivityAfterSuccess = (
  phase: MailConnectivityPhase,
): MailConnectivityPhase => phase === "current" ? "current" : "restored";

export const nextConnectivityAfterFailure = (
  online: boolean,
): MailConnectivityPhase => online ? "stale" : "offline";
