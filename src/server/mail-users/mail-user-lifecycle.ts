import "server-only";

import { createHmac } from "node:crypto";

import type { AdminMailUserLifecycleResult } from "@/domain/admin/mail-user";
import { connectionStore } from "@/server/connections/connection-store";
import { memberSessionOwnerKey } from "@/server/connections/member-session-metadata";
import {
  getManagedMailForwarding,
  removeMailForwarding,
} from "@/server/mail-forwarding/mail-forwarding.service";
import {
  mutateAdminMailUser,
  preflightAdminMailUserLifecycle,
} from "@/server/mail-users/mail-user-lifecycle-administration";
import { mailUserIdempotencyStore } from "@/server/mail-users/mail-user-idempotency-store";
import type { MailUserIdempotencyOutcome } from "@/server/mail-users/mail-user-idempotency.types";
import { ApiError } from "@/transport/http/api-error";

export interface MailUserLifecycleIntent {
  readonly domain: string;
  readonly email: string;
  readonly operation: "disable" | "delete";
  readonly userId: string;
}

export type MailUserLifecycleExecutionResult = AdminMailUserLifecycleResult & {
  readonly replayed?: true;
};

export const mailUserLifecycleFingerprint = (
  intent: MailUserLifecycleIntent,
  secret: string,
  profileRevision: string,
): string => createHmac("sha256", secret)
  .update("veda-mail:user-lifecycle:v1\0")
  .update(JSON.stringify({ ...intent, profileRevision }))
  .digest("base64url");

const conflict = (): never => {
  throw new ApiError(
    "This Idempotency-Key was already used for a different mailbox operation.",
    "MAIL_USER_IDEMPOTENCY_CONFLICT",
    409,
  );
};

const resultFromOutcome = (
  outcome: MailUserIdempotencyOutcome,
): AdminMailUserLifecycleResult => {
  if (outcome.kind === "failed") throw outcome.error;
  if (outcome.result.outcome === "created") return conflict();
  return outcome.result;
};

const run = async (
  intent: MailUserLifecycleIntent,
  profileRevision: string,
  onApplied?: () => void,
): Promise<AdminMailUserLifecycleResult> => {
  await preflightAdminMailUserLifecycle(intent, profileRevision);
  const forwarding = await getManagedMailForwarding(intent.email);
  let forwardingRemoved = false;
  if (forwarding.configuration) {
    await removeMailForwarding(intent.email, forwarding.revision);
    forwardingRemoved = true;
    onApplied?.();
  }
  const sessions = await connectionStore.listForOwnerAsync(
    memberSessionOwnerKey(intent.email),
  );
  for (const session of sessions) {
    await connectionStore.removeAsync(session.connection.id);
    onApplied?.();
  }
  let provider;
  try {
    provider = await mutateAdminMailUser(intent, profileRevision);
  } catch (error) {
    if (error instanceof ApiError &&
        error.code === "MAIL_USER_LIFECYCLE_OUTCOME_UNKNOWN") {
      onApplied?.();
    }
    throw error;
  }
  onApplied?.();
  return {
    ...provider,
    forwardingRemoved,
    sessionsRevoked: sessions.length,
  };
};

export const executeMailUserLifecycle = async (
  key: string,
  intent: MailUserLifecycleIntent,
  secret: string,
  profileRevision: string,
  onApplied?: () => void,
): Promise<MailUserLifecycleExecutionResult> => {
  const fingerprint = mailUserLifecycleFingerprint(intent, secret, profileRevision);
  const begun = await mailUserIdempotencyStore.begin(key, fingerprint);
  if (begun.kind === "conflict") return conflict();
  if (begun.kind === "orphaned") {
    throw new ApiError(
      "A previous mailbox lifecycle attempt has an unknown outcome. Check Stalwart before retrying.",
      "MAIL_USER_LIFECYCLE_OUTCOME_UNKNOWN",
      409,
    );
  }
  if (begun.kind === "capacity") {
    throw new ApiError(
      "Safe mailbox retry protection is temporarily full. Wait and try again.",
      "MAIL_USER_IDEMPOTENCY_CAPACITY",
      503,
    );
  }
  if (begun.kind === "replay") {
    if (begun.result.outcome === "created") return conflict();
    return { ...begun.result, replayed: true };
  }
  if (begun.kind === "pending") {
    return { ...resultFromOutcome(await begun.outcome), replayed: true };
  }
  try {
    const result = await run(intent, profileRevision, onApplied);
    let completed;
    try {
      completed = await mailUserIdempotencyStore.complete(
        key,
        fingerprint,
        begun.token,
        result,
      );
    } catch {
      throw new ApiError(
        "The mailbox changed but its safe replay result could not be recorded. Check Stalwart before retrying.",
        "MAIL_USER_LIFECYCLE_OUTCOME_UNKNOWN",
        409,
      );
    }
    if (completed.outcome === "created") return conflict();
    return completed;
  } catch (error) {
    const preserve = error instanceof ApiError &&
      error.code === "MAIL_USER_LIFECYCLE_OUTCOME_UNKNOWN";
    await mailUserIdempotencyStore
      .fail(key, fingerprint, begun.token, error, preserve)
      .catch(() => undefined);
    throw error;
  }
};
