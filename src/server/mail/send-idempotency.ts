import "server-only";

import type { SendReceipt } from "@/domain/mail/mail";
import type { ProviderConnection } from "@/domain/provider/provider";
import type { DraftId } from "@/domain/shared/brand";
import { connectionStore } from "@/server/connections/connection-store";
import {
  sendIdempotencyStore,
  type SendIdempotencyOutcome,
} from "@/server/mail/send-idempotency-store";
import {
  type CanonicalSendIntent,
  sendIntentFingerprint,
} from "@/server/mail/send-intent-fingerprint";
import { ApiError } from "@/transport/http/api-error";

export interface SendIdempotencyOwner {
  readonly draftId: DraftId;
  readonly token: string;
}

export type PreparedSend =
  | { readonly kind: "owner"; readonly owner: SendIdempotencyOwner }
  | { readonly kind: "replay"; readonly receipt: SendReceipt };

const conflict = (): never => {
  throw new ApiError(
    "This draft changed after its send attempt. Start a new draft before sending.",
    "MAIL_SEND_IDEMPOTENCY_CONFLICT",
    409,
  );
};

const capacity = (): never => {
  throw new ApiError(
    "Safe send retry protection is temporarily full. Wait before sending.",
    "MAIL_SEND_IDEMPOTENCY_CAPACITY",
    503,
  );
};

const inactive = (): never => {
  throw new ApiError(
    "This mail connection expired. Connect the account again.",
    "MEMBER_SESSION_EXPIRED",
    401,
  );
};

const outcomeReceipt = (outcome: SendIdempotencyOutcome): SendReceipt => {
  if (outcome.kind === "completed") return outcome.receipt;
  if (outcome.kind === "failed") throw outcome.error;
  throw new ApiError(
    "The mail session ended while this send was pending.",
    "MAIL_SEND_SESSION_ENDED",
    409,
  );
};

export const prepareIdempotentSend = async (
  connection: ProviderConnection,
  draftId: DraftId,
  intent: CanonicalSendIntent,
): Promise<PreparedSend> => {
  const begun = connectionStore.beginSendIfActive(
    connection,
    draftId,
    sendIntentFingerprint(intent),
  );
  if (begun.kind === "inactive") return inactive();
  if (begun.kind === "conflict") return conflict();
  if (begun.kind === "capacity") return capacity();
  if (begun.kind === "replay") {
    return { kind: "replay", receipt: begun.receipt };
  }
  if (begun.kind === "pending") {
    return {
      kind: "replay",
      receipt: outcomeReceipt(await begun.outcome),
    };
  }
  return {
    kind: "owner",
    owner: { draftId, token: begun.token },
  };
};

export const completeIdempotentSend = (
  connection: ProviderConnection,
  owner: SendIdempotencyOwner,
  receipt: SendReceipt,
): SendReceipt =>
  sendIdempotencyStore.complete(
    connection.id,
    owner.draftId,
    owner.token,
    receipt,
  ) ?? receipt;

export const failIdempotentSend = (
  connection: ProviderConnection,
  owner: SendIdempotencyOwner,
  error: unknown,
): void => {
  sendIdempotencyStore.fail(
    connection.id,
    owner.draftId,
    owner.token,
    error,
  );
};
