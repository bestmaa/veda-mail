import type { SendReceipt } from "@/domain/mail/mail";
import type { ConnectionId, DraftId } from "@/domain/shared/brand";

export type SendIdempotencyOutcome =
  | { readonly kind: "completed"; readonly receipt: SendReceipt }
  | { readonly error: unknown; readonly kind: "failed" }
  | { readonly kind: "in-progress" }
  | { readonly kind: "orphaned" };

export type SendIdempotencyBegin =
  | { readonly kind: "capacity" }
  | { readonly kind: "conflict" }
  | { readonly kind: "owner"; readonly token: string }
  | { readonly kind: "pending"; readonly outcome: Promise<SendIdempotencyOutcome> }
  | { readonly kind: "replay"; readonly receipt: SendReceipt };

export interface PendingSendEntry {
  readonly bytes: number;
  readonly connectionExpiresAt: number;
  readonly expiresAt: number;
  readonly fingerprint: string;
  readonly outcome: Promise<SendIdempotencyOutcome>;
  readonly resolve: (outcome: SendIdempotencyOutcome) => void;
  readonly state: "pending";
  readonly token: string;
}

interface CompletedSendEntry {
  readonly bytes: number;
  readonly expiresAt: number;
  readonly fingerprint: string;
  readonly receipt: SendReceipt;
  readonly state: "completed";
}

export type SendEntry = CompletedSendEntry | PendingSendEntry;

export interface SendBucket {
  readonly entries: Map<DraftId, SendEntry>;
}

export interface SendIdempotencyState {
  readonly byConnection: Map<ConnectionId, SendBucket>;
  bytes: number;
  entryCount: number;
  nextExpiresAt: number | undefined;
}
