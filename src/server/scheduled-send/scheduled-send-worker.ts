import "server-only";

import {
  deliverScheduledJob,
  isTerminalScheduledSendError,
  scheduledSendErrorMessage,
  type ScheduledDeliveryPort,
} from "@/server/scheduled-send/scheduled-send-delivery";
import { scheduledSendConfigured } from "@/server/scheduled-send/scheduled-send-key";
import {
  claimNextScheduledJob,
  recoverInterruptedScheduledJobs,
  settleScheduledJob,
  type ScheduledJobClaim,
} from "@/server/scheduled-send/scheduled-send-worker-store";

const MAX_ATTEMPTS = 6;
const MAX_JOBS_PER_TICK = 10;
const POLL_INTERVAL_MS = 15_000;
const RETRY_DELAYS_MS = [30_000, 2 * 60_000, 10 * 60_000, 30 * 60_000, 2 * 60 * 60_000];

const retryAt = (claim: ScheduledJobClaim, now: Date): string => {
  const index = Math.max(0, claim.job.attemptCount - 1);
  const delay = RETRY_DELAYS_MS[Math.min(index, RETRY_DELAYS_MS.length - 1)]!;
  return new Date(now.getTime() + delay).toISOString();
};

export const runScheduledJob = async (
  claim: ScheduledJobClaim,
  deliver?: ScheduledDeliveryPort,
  now = new Date(),
): Promise<void> => {
  try {
    const receipt = await deliverScheduledJob(claim.job, deliver);
    if (receipt.deliveryStatus === "uncertain") {
      await settleScheduledJob(claim, {
        error: "The provider could not confirm whether delivery completed.",
        kind: "uncertain",
      });
      return;
    }
    await settleScheduledJob(claim, { kind: "complete" });
  } catch (error) {
    const message = scheduledSendErrorMessage(error);
    if (isTerminalScheduledSendError(error) || claim.job.attemptCount >= MAX_ATTEMPTS) {
      await settleScheduledJob(claim, { error: message, kind: "failed" });
      return;
    }
    await settleScheduledJob(claim, {
      error: message,
      kind: "retry",
      retryAt: retryAt(claim, now),
    });
  }
};

export const processScheduledJobs = async (
  deliver?: ScheduledDeliveryPort,
  now = new Date(),
): Promise<number> => {
  let processed = 0;
  while (processed < MAX_JOBS_PER_TICK) {
    const claim = await claimNextScheduledJob(now);
    if (!claim) break;
    await runScheduledJob(claim, deliver, now);
    processed += 1;
  }
  return processed;
};

const schedulerGlobal = globalThis as typeof globalThis & {
  __vedaMailScheduledSendRunning?: Promise<void> | undefined;
  __vedaMailScheduledSendTimer?: ReturnType<typeof setInterval>;
};

const tick = (): void => {
  if (schedulerGlobal.__vedaMailScheduledSendRunning) return;
  const running = processScheduledJobs()
    .then(() => undefined)
    .catch(() => console.error("[veda-mail] Scheduled-send worker tick failed."))
    .finally(() => { schedulerGlobal.__vedaMailScheduledSendRunning = undefined; });
  schedulerGlobal.__vedaMailScheduledSendRunning = running;
};

export const startScheduledSendWorker = async (): Promise<void> => {
  if (!scheduledSendConfigured() || schedulerGlobal.__vedaMailScheduledSendTimer) {
    return;
  }
  const recovered = await recoverInterruptedScheduledJobs();
  if (recovered > 0) {
    console.warn(`[veda-mail] ${recovered} interrupted scheduled send(s) need review.`);
  }
  tick();
  const timer = setInterval(tick, POLL_INTERVAL_MS);
  timer.unref();
  schedulerGlobal.__vedaMailScheduledSendTimer = timer;
};
