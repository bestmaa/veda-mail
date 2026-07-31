import type { AdminMailUserCreateResult } from "@/domain/admin/mail-user";

export interface MailUserIdempotencyEntryBase {
  readonly createdAt: string;
  readonly expiresAt: number;
  readonly fingerprint: string;
}

export interface MailUserIdempotencyPendingEntry
  extends MailUserIdempotencyEntryBase {
  readonly state: "pending";
}

export interface MailUserIdempotencyCompletedEntry
  extends MailUserIdempotencyEntryBase {
  readonly result: AdminMailUserCreateResult;
  readonly state: "completed";
}

export type MailUserIdempotencyEntry =
  | MailUserIdempotencyPendingEntry
  | MailUserIdempotencyCompletedEntry;

export interface MailUserIdempotencyLedger {
  readonly entries: Readonly<Record<string, MailUserIdempotencyEntry>>;
  readonly version: 1;
}

export type MailUserIdempotencyOutcome =
  | { readonly kind: "completed"; readonly result: AdminMailUserCreateResult }
  | { readonly error: unknown; readonly kind: "failed" };

export type MailUserIdempotencyBegin =
  | { readonly kind: "capacity" }
  | { readonly kind: "conflict" }
  | { readonly kind: "orphaned" }
  | { readonly kind: "owner"; readonly token: string }
  | { readonly kind: "pending"; readonly outcome: Promise<MailUserIdempotencyOutcome> }
  | { readonly kind: "replay"; readonly result: AdminMailUserCreateResult };

export interface LiveMailUserProvision {
  readonly fingerprint: string;
  readonly outcome: Promise<MailUserIdempotencyOutcome>;
  readonly resolve: (outcome: MailUserIdempotencyOutcome) => void;
  readonly token: string;
}
