import "server-only";

import { createHmac } from "node:crypto";

import type { AdminMailUserCreateResult } from "@/domain/admin/mail-user";
import { ApiError } from "@/transport/http/api-error";
import { createAdminMailUser } from "@/server/mail-users/mail-user-administration";
import { mailUserIdempotencyStore } from "@/server/mail-users/mail-user-idempotency-store";
import type { MailUserIdempotencyOutcome } from "@/server/mail-users/mail-user-idempotency.types";

export interface MailUserProvisioningIntent {
  readonly displayName?: string;
  readonly email: string;
  readonly password: string;
}

export type AdminMailUserProvisioningResult = AdminMailUserCreateResult & {
  readonly replayed?: true;
};

export const mailUserProvisioningFingerprint = (
  intent: MailUserProvisioningIntent,
  secret: string,
  profileRevision: string,
): string =>
  createHmac("sha256", secret)
    .update("veda-mail:user-provisioning:v1\0")
    .update(
      JSON.stringify({
        displayName: intent.displayName ?? null,
        email: intent.email,
        profileRevision,
      }),
    )
    .digest("base64url");

const outcomeResult = (
  outcome: MailUserIdempotencyOutcome,
): AdminMailUserCreateResult => {
  if (outcome.kind === "completed") return outcome.result;
  throw outcome.error;
};

const conflict = (): never => {
  throw new ApiError(
    "This Idempotency-Key was already used for different mailbox details.",
    "MAIL_USER_IDEMPOTENCY_CONFLICT",
    409,
  );
};

const outcomeUnknown = (): ApiError =>
  new ApiError(
    "A previous attempt may have created this mailbox. Check Stalwart before retrying with a new key.",
    "MAIL_USER_CREATE_OUTCOME_UNKNOWN",
    409,
  );

const replayedResult = (
  result: AdminMailUserCreateResult,
): AdminMailUserProvisioningResult => ({ ...result, replayed: true });

export const provisionAdminMailUser = async (
  key: string,
  intent: MailUserProvisioningIntent,
  secret: string,
  profileRevision: string,
): Promise<AdminMailUserProvisioningResult> => {
  const fingerprint = mailUserProvisioningFingerprint(
    intent,
    secret,
    profileRevision,
  );
  const begun = await mailUserIdempotencyStore.begin(key, fingerprint);
  if (begun.kind === "conflict") return conflict();
  if (begun.kind === "orphaned") throw outcomeUnknown();
  if (begun.kind === "capacity") {
    throw new ApiError(
      "Safe mailbox retry protection is temporarily full. Wait and try again.",
      "MAIL_USER_IDEMPOTENCY_CAPACITY",
      503,
    );
  }
  if (begun.kind === "replay") return replayedResult(begun.result);
  if (begun.kind === "pending") {
    return replayedResult(outcomeResult(await begun.outcome));
  }

  try {
    const result = await createAdminMailUser(intent, profileRevision);
    try {
      return await mailUserIdempotencyStore.complete(
        key,
        fingerprint,
        begun.token,
        result,
      );
    } catch {
      const error = outcomeUnknown();
      await mailUserIdempotencyStore
        .fail(key, fingerprint, begun.token, error, true)
        .catch(() => undefined);
      throw error;
    }
  } catch (error) {
    const preserve =
      error instanceof ApiError &&
      error.code === "MAIL_USER_CREATE_OUTCOME_UNKNOWN";
    await mailUserIdempotencyStore
      .fail(key, fingerprint, begun.token, error, preserve)
      .catch(() => undefined);
    throw error;
  }
};
