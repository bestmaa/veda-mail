import "server-only";

import { randomUUID } from "node:crypto";

import type {
  SnoozeOwnedMailbox,
  SnoozeProviderPlan,
} from "@/domain/mail/snooze";
import {
  decryptSnoozeJobBook,
  encryptSnoozeJobBook,
} from "@/server/snooze/snooze-crypto";
import { readSnoozeFile, writeSnoozeFile } from "@/server/snooze/snooze-file";
import type { SnoozeJob, SnoozeJobBook } from "@/server/snooze/snooze-record";
import {
  readAllSnoozeBooks,
  writeOwnerSnoozes,
} from "@/server/snooze/snooze-store-access";
import { serializeSnoozeStore, snoozeLeaseId } from "@/server/snooze/snooze-store";

export interface SnoozeClaim {
  readonly job: SnoozeJob;
  readonly leaseId: string;
  readonly mailbox: SnoozeOwnedMailbox;
  readonly ownerKey: string;
  readonly phase: "hide" | "wake";
}
const nextBook = (
  book: SnoozeJobBook,
  jobs: readonly SnoozeJob[],
  mailbox = book.mailbox,
): SnoozeJobBook => ({ jobs: [...jobs], mailbox, revision: randomUUID(), version: 1 });
const phaseFor = (job: SnoozeJob, now: number): "hide" | "wake" | null => {
  if (["hiding", "retry-hide"].includes(job.state) &&
    Date.parse(job.nextAttemptAt) <= now) return "hide";
  if ((job.state === "retry-wake" && Date.parse(job.nextAttemptAt) <= now) ||
    (job.state === "snoozed" && Date.parse(job.wakeAt) <= now)) return "wake";
  return null;
};

export const claimNextSnoozeJob = (now = new Date()): Promise<SnoozeClaim | null> =>
  serializeSnoozeStore(async () => {
    const current = await readAllSnoozeBooks();
    const due = [...current.books.entries()].flatMap(([ownerKey, book]) =>
      book.jobs.flatMap((job) => {
        const phase = phaseFor(job, now.getTime());
        return phase ? [{ book, job, ownerKey, phase }] : [];
      })).sort((left, right) =>
      left.job.nextAttemptAt.localeCompare(right.job.nextAttemptAt))[0];
    if (!due) return null;
    if (!due.book.mailbox) throw new Error("Snooze mailbox intent is missing.");
    const leaseId = snoozeLeaseId();
    const claimed: SnoozeJob = { ...due.job,
      attemptCount: due.job.attemptCount + 1, leaseId,
      phase: due.phase,
      state: due.phase === "hide" ? "hiding" : "waking",
      updatedAt: now.toISOString() };
    await writeOwnerSnoozes(current.file, due.ownerKey,
      nextBook(due.book, due.book.jobs.map((job) => job.id === claimed.id ? claimed : job)));
    return { job: claimed, leaseId, mailbox: due.book.mailbox,
      ownerKey: due.ownerKey, phase: due.phase };
  });

export type SnoozeSettlement =
  | { readonly kind: "complete"; readonly mailbox?: SnoozeOwnedMailbox }
  | {
      readonly kind: "snoozed";
      readonly mailbox: SnoozeOwnedMailbox;
      readonly plan: SnoozeProviderPlan;
    }
  | {
      readonly error: string;
      readonly kind: "retry";
      readonly retryAt: string;
    }
  | { readonly error: string; readonly kind: "failed" | "needs-auth" };

export const settleSnoozeJob = (
  claim: SnoozeClaim,
  outcome: SnoozeSettlement,
): Promise<boolean> => serializeSnoozeStore(async () => {
  const file = await readSnoozeFile();
  const encrypted = file.owners[claim.ownerKey];
  if (!encrypted) return false;
  const book = decryptSnoozeJobBook(encrypted, claim.ownerKey);
  const current = book.jobs.find(({ id }) => id === claim.job.id);
  if (!current || current.leaseId !== claim.leaseId ||
    !["hiding", "waking"].includes(current.state)) return false;
  const now = new Date().toISOString();
  const jobs = outcome.kind === "complete" ? book.jobs.filter(({ id }) => id !== current.id)
    : book.jobs.map((job) => job.id !== current.id ? job : {
      ...job,
      ...(outcome.kind === "snoozed" ? { plan: outcome.plan } : {}),
      connection: outcome.kind === "failed" || outcome.kind === "needs-auth"
        ? null : job.connection,
      lastError: outcome.kind === "snoozed" ? null : outcome.error,
      leaseId: null,
      nextAttemptAt: outcome.kind === "retry" ? outcome.retryAt : job.wakeAt,
      state: outcome.kind === "snoozed" ? "snoozed" as const
        : outcome.kind === "retry" ? (claim.phase === "hide" ? "retry-hide" as const
          : "retry-wake" as const) : outcome.kind,
      updatedAt: now,
    });
  const mailbox = outcome.kind === "snoozed" ? outcome.mailbox
    : outcome.kind === "complete" ? outcome.mailbox ?? book.mailbox : book.mailbox;
  await writeOwnerSnoozes(file, claim.ownerKey, nextBook(book, jobs, mailbox));
  return true;
});

export const recoverInterruptedSnoozes = (): Promise<number> =>
  serializeSnoozeStore(async () => {
    const { books, file } = await readAllSnoozeBooks();
    const owners = { ...file.owners }; let recovered = 0;
    for (const [ownerKey, book] of books) {
      const jobs = book.jobs.map((job) => {
        if (!job.leaseId || !["hiding", "waking"].includes(job.state)) return job;
        recovered += 1;
        return { ...job, lastError: "Interrupted operation will be reconciled.",
          leaseId: null, nextAttemptAt: new Date().toISOString(),
          state: job.state === "hiding" ? "retry-hide" as const : "retry-wake" as const,
          updatedAt: new Date().toISOString() };
      });
      if (jobs.some((job, index) => job !== book.jobs[index])) {
        owners[ownerKey] = encryptSnoozeJobBook(nextBook(book, jobs), ownerKey);
      }
    }
    if (recovered) await writeSnoozeFile({ ...file, owners,
      updatedAt: new Date().toISOString() });
    return recovered;
  });
