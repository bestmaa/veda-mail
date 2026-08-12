import "server-only";

import { randomUUID } from "node:crypto";

import {
  encryptScheduledJobBook,
} from "@/server/scheduled-send/scheduled-send-crypto";
import {
  readAllScheduledJobBooks,
  writeOwnerScheduledJobs,
} from "@/server/scheduled-send/scheduled-send-store-access";
import {
  scheduledLeaseId,
  serializeScheduledJobStore,
} from "@/server/scheduled-send/scheduled-send-store";
import type {
  ScheduledJob,
  ScheduledJobBook,
} from "@/server/scheduled-send/scheduled-send-record";
import { writeScheduledJobFile } from "@/server/scheduled-send/scheduled-send-file";
import { sharedJobRepository } from "@/server/shared-state/shared-job-repository";

export const SCHEDULED_JOB_LEASE_MS = 10 * 60_000;

export interface ScheduledJobClaim {
  readonly job: ScheduledJob;
  readonly leaseId: string;
  readonly ownerKey: string;
}

const nextBook = (jobs: readonly ScheduledJob[]): ScheduledJobBook => ({
  jobs: [...jobs],
  revision: randomUUID(),
  version: 1,
});

export const claimNextScheduledJob = (
  now = new Date(),
): Promise<ScheduledJobClaim | null> => serializeScheduledJobStore(async () => {
  const current = await readAllScheduledJobBooks();
  const due = [...current.books.entries()]
    .flatMap(([ownerKey, book]) => book.jobs.map((job) => ({ job, ownerKey })))
    .filter(({ job }) =>
      (job.state === "pending" || job.state === "retrying") &&
      Date.parse(job.nextAttemptAt) <= now.getTime())
    .sort((left, right) =>
      left.job.nextAttemptAt.localeCompare(right.job.nextAttemptAt))[0];
  if (!due) return null;
  const leaseId = scheduledLeaseId();
  const book = current.books.get(due.ownerKey)!;
  const updatedAt = now.toISOString();
  const claimed = {
    ...due.job,
    attemptCount: due.job.attemptCount + 1,
    leaseExpiresAt: new Date(now.getTime() + SCHEDULED_JOB_LEASE_MS).toISOString(),
    leaseId,
    state: "sending" as const,
    updatedAt,
  };
  const updated = nextBook(book.jobs.map((job) =>
    job.id === claimed.id ? claimed : job));
  await writeOwnerScheduledJobs(current.file, due.ownerKey, updated);
  return { job: claimed, leaseId, ownerKey: due.ownerKey };
});

export const settleScheduledJob = (
  claim: ScheduledJobClaim,
  outcome:
    | { readonly kind: "complete" }
    | { readonly error: string; readonly kind: "failed" | "uncertain" }
    | { readonly error: string; readonly kind: "retry"; readonly retryAt: string },
): Promise<boolean> => serializeScheduledJobStore(async () => {
  const { books, file } = await readAllScheduledJobBooks();
  const book = books.get(claim.ownerKey);
  if (!book) return false;
  const current = book.jobs.find(({ id }) => id === claim.job.id);
  if (!current || current.leaseId !== claim.leaseId || current.state !== "sending") {
    return false;
  }
  const now = new Date().toISOString();
  const jobs = outcome.kind === "complete"
    ? book.jobs.filter(({ id }) => id !== current.id)
    : book.jobs.map((job) => job.id === current.id
      ? {
          ...job,
          lastError: outcome.error,
          leaseExpiresAt: null,
          leaseId: null,
          nextAttemptAt: outcome.kind === "retry" ? outcome.retryAt : now,
          state: outcome.kind === "retry" ? "retrying" as const : outcome.kind,
          updatedAt: now,
        }
      : job);
  await writeOwnerScheduledJobs(file, claim.ownerKey, nextBook(jobs));
  return true;
});

export const recoverInterruptedScheduledJobs = (now = new Date()): Promise<number> =>
  serializeScheduledJobStore(async () => {
    const { books, file } = await readAllScheduledJobBooks();
    let recovered = 0;
    const owners = file ? { ...file.owners } : null;
    for (const [ownerKey, book] of books) {
      const timestamp = now.toISOString();
      const jobs = book.jobs.map((job) => {
        if (job.state !== "sending" || (sharedJobRepository.configured() &&
          job.leaseExpiresAt && Date.parse(job.leaseExpiresAt) > now.getTime())) return job;
        recovered += 1;
        return {
          ...job,
          lastError: "Delivery outcome needs review after a server restart.",
          leaseExpiresAt: null,
          leaseId: null,
          nextAttemptAt: timestamp,
          state: "uncertain" as const,
          updatedAt: timestamp,
        };
      });
      if (jobs.some((job, index) => job !== book.jobs[index])) {
        const updated = nextBook(jobs);
        if (owners) owners[ownerKey] = encryptScheduledJobBook(updated, ownerKey);
        else await writeOwnerScheduledJobs(null, ownerKey, updated);
      }
    }
    if (recovered > 0 && file && owners) {
      await writeScheduledJobFile({ ...file, owners, updatedAt: new Date().toISOString() });
    }
    return recovered;
  });
