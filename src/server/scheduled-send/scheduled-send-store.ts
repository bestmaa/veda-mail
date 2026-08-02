import "server-only";

import { randomBytes, randomUUID } from "node:crypto";

import {
  MAX_SCHEDULED_MESSAGE_OWNERS,
  MAX_SCHEDULED_MESSAGES_PER_OWNER,
  MAX_SCHEDULE_DELAY_MS,
  MIN_SCHEDULE_DELAY_MS,
  type ScheduleMessageInput,
  type ScheduledMessageBook,
  type ScheduledMessageOwner,
} from "@/domain/mail/scheduled-send";
import type { ScheduledMessageId } from "@/domain/shared/brand";
import type { ProviderConnection } from "@/domain/provider/provider";
import { scheduledSendConfigured } from "@/server/scheduled-send/scheduled-send-key";
import { scheduledMessageBookFromJobs } from "@/server/scheduled-send/scheduled-send-projection";
import {
  emptyScheduledJobBook,
  readOwnerScheduledJobs,
  writeOwnerScheduledJobs,
} from "@/server/scheduled-send/scheduled-send-store-access";
import {
  scheduledMessageBusy,
  scheduledMessageCapacity,
  scheduledMessageConflict,
  scheduledMessageNotFound,
  scheduledSendUnavailable,
} from "@/server/scheduled-send/scheduled-send-store-errors";
import type { ScheduledJob } from "@/server/scheduled-send/scheduled-send-record";
import { ApiError } from "@/transport/http/api-error";

const globalState = globalThis as typeof globalThis & {
  __vedaMailScheduledJobQueue?: Promise<void>;
};
globalState.__vedaMailScheduledJobQueue ??= Promise.resolve();

export const serializeScheduledJobStore = async <T>(
  task: () => Promise<T>,
): Promise<T> => {
  const result = globalState.__vedaMailScheduledJobQueue!.then(task, task);
  globalState.__vedaMailScheduledJobQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
};

const safely = async <T>(task: () => Promise<T>): Promise<T> => {
  if (!scheduledSendConfigured()) return scheduledSendUnavailable();
  try {
    return await task();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    return scheduledSendUnavailable();
  }
};

const assertScheduledAt = (scheduledAt: string, now = Date.now()): void => {
  const timestamp = Date.parse(scheduledAt);
  if (
    !Number.isFinite(timestamp) ||
    timestamp < now + MIN_SCHEDULE_DELAY_MS ||
    timestamp > now + MAX_SCHEDULE_DELAY_MS
  ) {
    throw new ApiError(
      "Choose a send time between 5 seconds and 366 days from now.",
      "INVALID_SCHEDULED_SEND_TIME",
      422,
    );
  }
};

const nextBook = (jobs: readonly ScheduledJob[]) => ({
  jobs: [...jobs],
  revision: randomUUID(),
  version: 1 as const,
});

const createJob = (input: ScheduleMessageInput): ScheduledJob => {
  const now = new Date().toISOString();
  return {
    attemptCount: 0,
    connection: input.connection,
    createdAt: now,
    id: randomUUID(),
    lastError: null,
    leaseId: null,
    nextAttemptAt: input.scheduledAt,
    request: {
      bcc: [...input.request.bcc],
      body: input.request.body,
      cc: [...input.request.cc],
      draftId: input.request.draftId,
      expectedDraftRevision: input.request.expectedDraftRevision,
      ...(input.request.htmlBody ? { htmlBody: input.request.htmlBody } : {}),
      ...(input.request.inReplyTo ? { inReplyTo: input.request.inReplyTo } : {}),
      providerDraftId: input.request.providerDraftId,
      subject: input.request.subject,
      to: [...input.request.to],
    },
    scheduledAt: input.scheduledAt,
    state: "pending",
    updatedAt: now,
    version: 1,
  };
};

export const scheduledSendStore = {
  cancel(owner: ScheduledMessageOwner, messageId: ScheduledMessageId) {
    return safely(() => serializeScheduledJobStore(async () => {
      const current = await readOwnerScheduledJobs(owner);
      const book = current.book;
      const job = book?.jobs.find(({ id }) => id === messageId);
      if (!book || !job) return scheduledMessageNotFound();
      if (job.state === "sending") return scheduledMessageBusy();
      const updated = nextBook(book.jobs.filter(({ id }) => id !== messageId));
      await writeOwnerScheduledJobs(current.file, current.ownerKey, updated);
    }));
  },

  list(owner: ScheduledMessageOwner): Promise<ScheduledMessageBook> {
    return safely(async () =>
      scheduledMessageBookFromJobs((await readOwnerScheduledJobs(owner)).book));
  },

  schedule(input: ScheduleMessageInput): Promise<ScheduledMessageBook> {
    assertScheduledAt(input.scheduledAt);
    return safely(() => serializeScheduledJobStore(async () => {
      const current = await readOwnerScheduledJobs(input.owner);
      const book = current.book ?? emptyScheduledJobBook();
      if (book.jobs.length >= MAX_SCHEDULED_MESSAGES_PER_OWNER) {
        return scheduledMessageCapacity();
      }
      if (
        current.book === null &&
        Object.keys(current.file.owners).length >= MAX_SCHEDULED_MESSAGE_OWNERS
      ) {
        return scheduledMessageCapacity();
      }
      if (book.jobs.some(({ request }) =>
        request.providerDraftId === input.request.providerDraftId)) {
        return scheduledMessageConflict();
      }
      const updated = nextBook([...book.jobs, createJob(input)]);
      await writeOwnerScheduledJobs(current.file, current.ownerKey, updated);
      return scheduledMessageBookFromJobs(updated);
    }));
  },

  reschedule(
    owner: ScheduledMessageOwner,
    messageId: ScheduledMessageId,
    scheduledAt: string,
    connection?: ProviderConnection,
  ): Promise<ScheduledMessageBook> {
    assertScheduledAt(scheduledAt);
    return safely(() => serializeScheduledJobStore(async () => {
      const current = await readOwnerScheduledJobs(owner);
      const book = current.book;
      const target = book?.jobs.find(({ id }) => id === messageId);
      if (!book || !target) return scheduledMessageNotFound();
      if (target.state === "sending" || target.state === "uncertain") {
        return scheduledMessageBusy();
      }
      const now = new Date().toISOString();
      const updated = nextBook(book.jobs.map((job) => job.id === messageId
        ? {
            ...job,
            attemptCount: 0,
            ...(connection ? { connection } : {}),
            lastError: null,
            leaseId: null,
            nextAttemptAt: scheduledAt,
            scheduledAt,
            state: "pending" as const,
            updatedAt: now,
          }
        : job));
      await writeOwnerScheduledJobs(current.file, current.ownerKey, updated);
      return scheduledMessageBookFromJobs(updated);
    }));
  },
};

export const scheduledLeaseId = (): string =>
  randomBytes(32).toString("base64url");
