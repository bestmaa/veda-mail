import "server-only";

import type { ProviderConnection } from "@/domain/provider/provider";
import { id } from "@/domain/shared/brand";
import { clearGateway } from "@/server/mail/gateway-cache";
import {
  getSnoozeOperationPort,
  SnoozeProviderError,
  type SnoozeOperationPort,
} from "@/server/snooze/snooze-operation.port";
import { snoozeConfigured } from "@/server/snooze/snooze-key";
import type { SnoozeJob } from "@/server/snooze/snooze-record";
import {
  claimNextSnoozeJob,
  recoverInterruptedSnoozes,
  settleSnoozeJob,
  type SnoozeClaim,
} from "@/server/snooze/snooze-worker-store";

const MAX_ATTEMPTS = 6;
const MAX_JOBS_PER_TICK = 10;
const POLL_INTERVAL_MS = 15_000;
const RETRY_DELAYS_MS = [30_000, 120_000, 600_000, 1_800_000, 7_200_000];
const connectionFor = (job: SnoozeJob): ProviderConnection | null => job.connection
  ? { ...job.connection, id: id.connection(job.connection.id),
      providerId: id.provider(job.connection.providerId) } : null;
const retryAt = (claim: SnoozeClaim, now: Date) => new Date(now.getTime() +
  RETRY_DELAYS_MS[Math.min(Math.max(0, claim.job.attemptCount - 1),
    RETRY_DELAYS_MS.length - 1)]!).toISOString();

export const runSnoozeJob = async (
  claim: SnoozeClaim,
  port: SnoozeOperationPort,
  now = new Date(),
): Promise<void> => {
  const connection = connectionFor(claim.job);
  if (!connection) {
    await settleSnoozeJob(claim, { error: "Sign in to retry this snooze.",
      kind: "needs-auth" });
    return;
  }
  try {
    const inspected = await port.inspect(connection, claim.job.plan);
    if (claim.phase === "hide") {
      if (inspected.state === "deleted") {
        await settleSnoozeJob(claim, { kind: "complete", mailbox: inspected.ownedMailbox });
      } else {
        const result = inspected.state === "snoozed" ? inspected
          : await port.hide(connection, inspected.plan);
        await settleSnoozeJob(claim, { kind: "snoozed",
          mailbox: result.ownedMailbox, plan: result.plan });
      }
    } else if (inspected.state !== "snoozed" &&
      inspected.state !== "restored-marker") {
      await settleSnoozeJob(claim, { kind: "complete", mailbox: inspected.ownedMailbox });
    } else {
      const restored = await port.restore(connection, inspected.plan);
      await settleSnoozeJob(claim, { kind: "complete", mailbox: restored.ownedMailbox });
    }
  } catch (error) {
    const kind = error instanceof SnoozeProviderError ? error.kind : "transient";
    if (kind === "authentication") {
      await settleSnoozeJob(claim, { error: "Sign in to retry this snooze.",
        kind: "needs-auth" });
    } else if (kind === "terminal" || claim.job.attemptCount >= MAX_ATTEMPTS) {
      await settleSnoozeJob(claim, { error: "The provider could not complete this snooze.",
        kind: "failed" });
    } else {
      await settleSnoozeJob(claim, { error: "The provider is temporarily unavailable.",
        kind: "retry", retryAt: retryAt(claim, now) });
    }
  } finally { clearGateway(connection.id); }
};

export const processSnoozeJobs = async (
  port: SnoozeOperationPort,
  now = new Date(),
): Promise<number> => {
  let processed = 0;
  while (processed < MAX_JOBS_PER_TICK) {
    const claim = await claimNextSnoozeJob(now);
    if (!claim) break;
    await runSnoozeJob(claim, port, now); processed += 1;
  }
  return processed;
};

const workerGlobal = globalThis as typeof globalThis & {
  __vedaMailSnoozeRunning?: Promise<void>;
  __vedaMailSnoozeTimer?: ReturnType<typeof setInterval>;
};
const tick = (port: SnoozeOperationPort): void => {
  if (workerGlobal.__vedaMailSnoozeRunning) return;
  const running = processSnoozeJobs(port).then(() => undefined)
    .catch(() => console.error("[veda-mail] Snooze worker tick failed."))
    .finally(() => { delete workerGlobal.__vedaMailSnoozeRunning; });
  workerGlobal.__vedaMailSnoozeRunning = running;
};
export const startSnoozeWorker = async (
  suppliedPort?: SnoozeOperationPort,
): Promise<void> => {
  if (!snoozeConfigured() || workerGlobal.__vedaMailSnoozeTimer) return;
  const port = suppliedPort ?? getSnoozeOperationPort();
  const recovered = await recoverInterruptedSnoozes();
  if (recovered) console.warn(`[veda-mail] Reconciliating ${recovered} snooze(s).`);
  tick(port);
  const timer = setInterval(() => tick(port), POLL_INTERVAL_MS); timer.unref();
  workerGlobal.__vedaMailSnoozeTimer = timer;
};
