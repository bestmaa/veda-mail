import "server-only";

import type { AdminMailUserCreateResult } from "@/domain/admin/mail-user";
import {
  MAIL_USER_IDEMPOTENCY_POLL_MS,
  MAIL_USER_IDEMPOTENCY_OWNER_MS,
  MAIL_USER_IDEMPOTENCY_SHARED_RETRIES,
  MAIL_USER_IDEMPOTENCY_TTL_MS,
  MAIL_USER_IDEMPOTENCY_WAIT_MS,
  MAX_MAIL_USER_IDEMPOTENCY_ENTRIES,
} from "@/server/mail-users/mail-user-idempotency-policy";
import {
  replaceSharedMailUserIdempotencyLedger,
  sharedMailUserIdempotencyLedger,
} from "@/server/mail-users/mail-user-idempotency-shared";
import type {
  MailUserIdempotencyBegin,
  MailUserIdempotencyLedger,
  MailUserIdempotencyOutcome,
} from "@/server/mail-users/mail-user-idempotency.types";
import { ApiError } from "@/transport/http/api-error";

const clone = (result: AdminMailUserCreateResult): AdminMailUserCreateResult =>
  structuredClone(result);
const pause = () => new Promise((resolve) =>
  setTimeout(resolve, MAIL_USER_IDEMPOTENCY_POLL_MS));
const prune = (
  ledger: MailUserIdempotencyLedger,
  now: number,
): MailUserIdempotencyLedger => ({
  entries: Object.fromEntries(
    Object.entries(ledger.entries).filter(([, entry]) => entry.expiresAt > now),
  ),
  version: 1 as const,
});
const changedTooFrequently = (): never => {
  throw new ApiError(
    "Safe mailbox retry protection is temporarily busy.",
    "MAIL_USER_IDEMPOTENCY_BUSY",
    503,
  );
};
const waitForOutcome = async (
  key: string,
  fingerprint: string,
): Promise<MailUserIdempotencyOutcome> => {
  const deadline = Date.now() + MAIL_USER_IDEMPOTENCY_WAIT_MS;
  while (Date.now() < deadline) {
    const { ledger } = await sharedMailUserIdempotencyLedger();
    const entry = ledger.entries[key];
    if (!entry) return {
      error: new ApiError(
        "The concurrent mailbox attempt ended without a replay result. Retry safely.",
        "MAIL_USER_IDEMPOTENCY_RETRY",
        503,
      ),
      kind: "failed",
    };
    if (entry.fingerprint !== fingerprint) return {
      error: new ApiError(
        "The mailbox retry key changed while waiting.",
        "MAIL_USER_IDEMPOTENCY_CONFLICT",
        409,
      ),
      kind: "failed",
    };
    if (entry.state === "completed") {
      return { kind: "completed", result: clone(entry.result) };
    }
    if (!entry.ownerToken || !entry.ownerExpiresAt ||
        entry.ownerExpiresAt <= Date.now()) {
      return {
        error: new ApiError(
          "The mailbox creation owner disappeared before recording an outcome.",
          "MAIL_USER_CREATE_OUTCOME_UNKNOWN",
          409,
        ),
        kind: "failed",
      };
    }
    await pause();
  }
  return {
    error: new ApiError(
      "The mailbox creation outcome is still unknown. Check the provider before retrying.",
      "MAIL_USER_CREATE_OUTCOME_UNKNOWN",
      409,
    ),
    kind: "failed",
  };
};

export const beginSharedMailUserIdempotency = async (
  key: string,
  fingerprint: string,
): Promise<MailUserIdempotencyBegin> => {
  for (let attempt = 0; attempt < MAIL_USER_IDEMPOTENCY_SHARED_RETRIES; attempt += 1) {
    const current = await sharedMailUserIdempotencyLedger();
    const ledger = prune(current.ledger, Date.now());
    const existing = ledger.entries[key];
    if (existing) {
      if (existing.fingerprint !== fingerprint) return { kind: "conflict" };
      if (existing.state === "completed") {
        return { kind: "replay", result: clone(existing.result) };
      }
      return existing.ownerToken && existing.ownerExpiresAt &&
        existing.ownerExpiresAt > Date.now()
        ? { kind: "pending", outcome: waitForOutcome(key, fingerprint) }
        : { kind: "orphaned" };
    }
    if (Object.keys(ledger.entries).length >= MAX_MAIL_USER_IDEMPOTENCY_ENTRIES) {
      return { kind: "capacity" };
    }
    const token = crypto.randomUUID();
    const now = Date.now();
    const updated = {
      entries: {
        ...ledger.entries,
        [key]: {
          createdAt: new Date(now).toISOString(),
          expiresAt: now + MAIL_USER_IDEMPOTENCY_TTL_MS,
          fingerprint,
          ownerExpiresAt: now + MAIL_USER_IDEMPOTENCY_OWNER_MS,
          ownerToken: token,
          state: "pending" as const,
        },
      },
      version: 1 as const,
    };
    if (await replaceSharedMailUserIdempotencyLedger(current, updated)) {
      return { kind: "owner", token };
    }
  }
  return changedTooFrequently();
};

export const completeSharedMailUserIdempotency = async (
  key: string,
  fingerprint: string,
  token: string,
  result: AdminMailUserCreateResult,
): Promise<AdminMailUserCreateResult> => {
  for (let attempt = 0; attempt < MAIL_USER_IDEMPOTENCY_SHARED_RETRIES; attempt += 1) {
    const current = await sharedMailUserIdempotencyLedger();
    const ledger = prune(current.ledger, Date.now());
    const existing = ledger.entries[key];
    if (existing?.state === "completed" && existing.fingerprint === fingerprint) {
      return clone(existing.result);
    }
    if (existing?.state !== "pending" || existing.fingerprint !== fingerprint ||
        existing.ownerToken !== token) {
      throw new ApiError(
        "The mailbox was created but its safe replay claim changed unexpectedly.",
        "MAIL_USER_CREATE_OUTCOME_UNKNOWN",
        409,
      );
    }
    const updated = {
      entries: {
        ...ledger.entries,
        [key]: {
          createdAt: existing.createdAt,
          expiresAt: Date.now() + MAIL_USER_IDEMPOTENCY_TTL_MS,
          fingerprint: existing.fingerprint,
          result: clone(result),
          state: "completed" as const,
        },
      },
      version: 1 as const,
    };
    if (await replaceSharedMailUserIdempotencyLedger(current, updated)) return clone(result);
  }
  return changedTooFrequently();
};

export const failSharedMailUserIdempotency = async (
  key: string,
  fingerprint: string,
  token: string,
  preserve: boolean,
): Promise<void> => {
  for (let attempt = 0; attempt < MAIL_USER_IDEMPOTENCY_SHARED_RETRIES; attempt += 1) {
    const current = await sharedMailUserIdempotencyLedger();
    const entry = current.ledger.entries[key];
    if (entry?.state !== "pending" ||
        entry.fingerprint !== fingerprint || entry.ownerToken !== token) return;
    const entries = { ...current.ledger.entries };
    if (preserve) {
      entries[key] = {
        createdAt: entry.createdAt,
        expiresAt: entry.expiresAt,
        fingerprint: entry.fingerprint,
        state: "pending",
      };
    } else delete entries[key];
    if (await replaceSharedMailUserIdempotencyLedger(current, {
      entries, version: 1,
    })) return;
  }
  return changedTooFrequently();
};
