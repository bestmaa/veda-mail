import "server-only";

import type {
  ScheduledMessage,
  ScheduledMessageBook,
} from "@/domain/mail/scheduled-send";
import { id } from "@/domain/shared/brand";
import type {
  ScheduledJob,
  ScheduledJobBook,
} from "@/server/scheduled-send/scheduled-send-record";

export const scheduledMessageFromJob = (
  job: ScheduledJob,
): ScheduledMessage => ({
  attemptCount: job.attemptCount,
  createdAt: job.createdAt,
  id: id.scheduledMessage(job.id),
  lastError: job.lastError,
  purpose: job.purpose,
  recipientCount:
    job.request.to.length + job.request.cc.length + job.request.bcc.length,
  scheduledAt: job.scheduledAt,
  status: job.state,
  subject: job.request.subject,
  updatedAt: job.updatedAt,
});

export const scheduledMessageBookFromJobs = (
  book: ScheduledJobBook | null,
): ScheduledMessageBook => ({
  messages: (book?.jobs ?? [])
    .map(scheduledMessageFromJob)
    .sort((left, right) => left.scheduledAt.localeCompare(right.scheduledAt)),
  revision: book?.revision ?? null,
  version: 1,
});
