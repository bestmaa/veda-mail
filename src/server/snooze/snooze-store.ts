import "server-only";

import { randomBytes, randomUUID } from "node:crypto";

import {
  MAX_SNOOZE_DELAY_MS,
  MAX_SNOOZE_OWNERS,
  MAX_SNOOZED_MESSAGES_PER_OWNER,
  MIN_SNOOZE_DELAY_MS,
  type SnoozeBulkItem,
  type SnoozeOwnedMailbox,
  type SnoozePreflightResult,
  type SnoozeOwner,
} from "@/domain/mail/snooze";
import type { ProviderConnection } from "@/domain/provider/provider";
import { projectSnoozeBook } from "@/server/snooze/snooze-projection";
import type {
  SnoozeJob,
  SnoozeJobBook,
} from "@/server/snooze/snooze-record";
import {
  emptySnoozeBook,
  readOwnerSnoozes,
  writeOwnerSnoozes,
} from "@/server/snooze/snooze-store-access";
import { sharedJobRepository } from "@/server/shared-state/shared-job-repository";
import { ApiError } from "@/transport/http/api-error";

const globalState = globalThis as typeof globalThis & {
  __vedaMailSnoozeStoreQueue?: Promise<void>;
};
globalState.__vedaMailSnoozeStoreQueue ??= Promise.resolve();
export const serializeSnoozeStore = async <T>(task: () => Promise<T>): Promise<T> => {
  const locked = () => sharedJobRepository.withLock("snooze", task);
  const result = globalState.__vedaMailSnoozeStoreQueue!.then(locked, locked);
  globalState.__vedaMailSnoozeStoreQueue = result.then(() => undefined, () => undefined);
  return result;
};
export const assertWakeAt = (wakeAt: string, now = Date.now()): void => {
  const timestamp = Date.parse(wakeAt);
  if (!Number.isFinite(timestamp) || timestamp < now + MIN_SNOOZE_DELAY_MS ||
    timestamp > now + MAX_SNOOZE_DELAY_MS) {
    throw new ApiError("Choose a snooze time between 5 seconds and 366 days.",
      "INVALID_SNOOZE_TIME", 422);
  }
};
const changedBook = (
  book: SnoozeJobBook,
  jobs: readonly SnoozeJob[],
  mailbox = book.mailbox,
): SnoozeJobBook => ({ jobs: [...jobs], mailbox, revision: randomUUID(), version: 1 });

export interface AdmitSnoozeInput {
  readonly connection: ProviderConnection;
  readonly item: SnoozeBulkItem;
  readonly operationId: string;
  readonly owner: SnoozeOwner;
  readonly preflight: SnoozePreflightResult;
}

export const snoozeLeaseId = () => randomBytes(32).toString("base64url");
export const snoozeStore = {
  ensureMailboxIntent(owner: SnoozeOwner, mailbox: SnoozeOwnedMailbox) {
    return serializeSnoozeStore(async () => {
      const current = await readOwnerSnoozes(owner);
      const book = current.book ?? emptySnoozeBook();
      if (!current.book && current.ownerCount >= MAX_SNOOZE_OWNERS) {
        throw new ApiError("Snooze capacity has been reached.", "SNOOZE_CAPACITY", 409);
      }
      if (book.mailbox && JSON.stringify(book.mailbox) !== JSON.stringify(mailbox)) {
        return book.mailbox;
      }
      if (!book.mailbox) {
        const updated = changedBook(book, book.jobs, mailbox);
        await writeOwnerSnoozes(current.file, current.ownerKey, updated);
        return mailbox;
      }
      return book.mailbox;
    });
  },
  admit(input: AdmitSnoozeInput) {
    assertWakeAt(input.item.wakeAt);
    return serializeSnoozeStore(async () => {
      const current = await readOwnerSnoozes(input.owner);
      const book = current.book ?? emptySnoozeBook();
      if (book.jobs.length >= MAX_SNOOZED_MESSAGES_PER_OWNER ||
        (!current.book && current.ownerCount >= MAX_SNOOZE_OWNERS)) {
        throw new ApiError("Snooze capacity has been reached.", "SNOOZE_CAPACITY", 409);
      }
      if (book.jobs.some((job) => job.messageId === input.item.messageId)) {
        throw new ApiError("This message is already snoozed.", "SNOOZE_CONFLICT", 409);
      }
      const now = new Date().toISOString();
      const job: SnoozeJob = {
        attemptCount: 0, connection: input.connection, createdAt: now,
        from: [...input.preflight.from], id: input.operationId, lastError: null,
        leaseExpiresAt: null, leaseId: null, messageId: input.item.messageId,
        nextAttemptAt: now,
        phase: "hide",
        plan: input.preflight.plan, sourceMailboxId: input.item.sourceMailboxId,
        state: "hiding", subject: input.preflight.subject, updatedAt: now,
        version: 1, wakeAt: input.item.wakeAt,
      };
      const updated = changedBook(book, [...book.jobs, job]);
      await writeOwnerSnoozes(current.file, current.ownerKey, updated);
      return { book: projectSnoozeBook(updated), jobId: job.id,
        ownerKey: current.ownerKey };
    });
  },
  list(owner: SnoozeOwner) {
    return readOwnerSnoozes(owner).then(({ book }) => projectSnoozeBook(book));
  },
  reschedule(owner: SnoozeOwner, jobId: string, wakeAt: string,
    connection: ProviderConnection) {
    assertWakeAt(wakeAt);
    return serializeSnoozeStore(async () => {
      const current = await readOwnerSnoozes(owner);
      const target = current.book?.jobs.find(({ id }) => id === jobId);
      if (!current.book || !target) throw new ApiError("Snooze not found.", "SNOOZE_NOT_FOUND", 404);
      if (["hiding", "waking"].includes(target.state) && target.leaseId) {
        throw new ApiError("Snooze is busy.", "SNOOZE_BUSY", 409);
      }
      const now = new Date().toISOString();
      const updated = changedBook(current.book, current.book.jobs.map((job) => job.id === jobId
        ? { ...job, connection, lastError: null, wakeAt, updatedAt: now } : job));
      await writeOwnerSnoozes(current.file, current.ownerKey, updated);
      return projectSnoozeBook(updated);
    });
  },
  requestRestore(owner: SnoozeOwner, jobId: string, connection: ProviderConnection) {
    return serializeSnoozeStore(async () => {
      const current = await readOwnerSnoozes(owner);
      const target = current.book?.jobs.find(({ id }) => id === jobId);
      if (!current.book || !target) {
        throw new ApiError("Snooze not found.", "SNOOZE_NOT_FOUND", 404);
      }
      if (target.leaseId) throw new ApiError("Snooze is busy.", "SNOOZE_BUSY", 409);
      const now = new Date().toISOString();
      const updated = changedBook(current.book, current.book.jobs.map((job) =>
        job.id === jobId ? { ...job, attemptCount: 0, connection, lastError: null,
          nextAttemptAt: now, phase: "wake" as const, state: "retry-wake" as const,
          updatedAt: now, wakeAt: now } : job));
      await writeOwnerSnoozes(current.file, current.ownerKey, updated);
      return projectSnoozeBook(updated);
    });
  },
  retry(owner: SnoozeOwner, jobId: string, connection: ProviderConnection) {
    return serializeSnoozeStore(async () => {
      const current = await readOwnerSnoozes(owner);
      const target = current.book?.jobs.find(({ id }) => id === jobId);
      if (!current.book || !target) {
        throw new ApiError("Snooze not found.", "SNOOZE_NOT_FOUND", 404);
      }
      if (target.state !== "failed" && target.state !== "needs-auth") {
        throw new ApiError("Snooze is not retryable.", "SNOOZE_NOT_RETRYABLE", 409);
      }
      const now = new Date().toISOString();
      const updated = changedBook(current.book, current.book.jobs.map((job) =>
        job.id === jobId ? { ...job, attemptCount: 0, connection, lastError: null,
          nextAttemptAt: now, state: job.phase === "hide" ? "retry-hide" as const
            : "retry-wake" as const, updatedAt: now } : job));
      await writeOwnerSnoozes(current.file, current.ownerKey, updated);
      return projectSnoozeBook(updated);
    });
  },
};
