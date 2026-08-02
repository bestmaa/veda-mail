import type { ComposerDraftRetryKind } from "@/presentation/features/mail-workspace/composer-draft-state";
import {
  canComposerAutosaveRun,
  COMPOSER_AUTOSAVE_IDLE_MS, COMPOSER_AUTOSAVE_MAX_WAIT_MS,
  composerAutosaveBrowserClock, composerAutosaveRetryDelay,
  isComposerAutosaveRetryable,
  type ComposerAutosaveClock, type ComposerAutosaveInput,
  type ComposerAutosavePhase, type ComposerAutosaveStatus,
} from "@/presentation/features/mail-workspace/composer-autosave.types";
export class ComposerAutosaveCoordinator {
  private activeGeneration: number | null = null; private awaitingRefresh = false;
  private epoch = 0; private failureCount = 0;
  private firstDirtyAt: number | null = null; private inFlight = false;
  private input: ComposerAutosaveInput | null = null; private lastEditAt: number | null = null;
  private online = true; private reconciliationGeneration: number | null = null;
  private retryDueAt: number | null = null; private retryKind: ComposerDraftRetryKind = "none";
  private timer: ReturnType<typeof setTimeout> | null = null; private trailing = false;
  private updateSequence = 0; private waitForUpdateAfter = 0;
  public constructor(private readonly onStatus: (status: ComposerAutosaveStatus) => void,
    private readonly clock: ComposerAutosaveClock = composerAutosaveBrowserClock) {}
  public update(input: ComposerAutosaveInput): void {
    const previous = this.input;
    this.input = input;
    this.updateSequence += 1;
    const generationChanged = previous !== null &&
      previous.contentGeneration !== input.contentGeneration;
    const now = this.clock.now();
    if (!input.enabled) {
      this.epoch += 1;
      this.inFlight = false; this.activeGeneration = null;
      this.resetSchedule();
      this.emit("disabled");
      return;
    }
    if (generationChanged && previous?.retryKind === "blocked" &&
      input.retryKind === "none") {
      this.retryKind = "none";
      this.resetDirtyWindow();
    }
    if (isComposerAutosaveRetryable(input.retryKind) &&
      this.retryKind !== input.retryKind) {
      this.retryKind = input.retryKind;
      this.retryDueAt = null;
    }
    if (generationChanged && input.hasUserEdits) {
      if (this.firstDirtyAt === null) this.firstDirtyAt = now;
      this.lastEditAt = now;
      if (this.inFlight && input.contentGeneration !== this.activeGeneration) {
        this.trailing = true;
      }
      if (!isComposerAutosaveRetryable(input.retryKind) &&
        !isComposerAutosaveRetryable(this.retryKind)) this.failureCount = 0;
    } else if (input.hasUserEdits && this.firstDirtyAt === null) {
      this.firstDirtyAt = now;
      this.lastEditAt = now;
    }
    if (!input.hasUserEdits && input.retryKind !== "reconcile") {
      this.resetDirtyWindow();
    }
    if (this.inFlight) {
      this.cancelTimer();
      this.emit("saving");
      return;
    }
    if (this.awaitingRefresh) {
      if (this.updateSequence <= this.waitForUpdateAfter) return;
      this.awaitingRefresh = false;
      if (this.trailing && input.retryKind === "none" && input.hasUserEdits) {
        this.schedule();
        return;
      }
    }
    this.schedule();
  }
  public setOnline(online: boolean): void {
    if (this.online === online) return;
    this.online = online; this.schedule();
  }
  public dispose(): void {
    this.epoch += 1;
    this.input = null;
    this.inFlight = false;
    this.activeGeneration = null;
    this.resetSchedule();
  }
  private schedule(): void {
    this.cancelTimer();
    const input = this.input;
    if (!input) return;
    if (this.inFlight) {
      this.emit("saving");
      return;
    }
    if (this.awaitingRefresh) return;
    if (!input.enabled) {
      this.emit("disabled");
      return;
    }
    if (input.paused) {
      this.emit("paused");
      return;
    }
    const retryKind = input.retryKind === "none" ? this.retryKind : input.retryKind;
    if (retryKind === "blocked") {
      this.retryKind = "blocked";
      this.retryDueAt = null;
      this.emit("blocked");
      return;
    }
    const hasIntent = input.hasUserEdits || retryKind === "reconcile";
    if (!hasIntent) {
      this.resetDirtyWindow();
      this.retryKind = "none";
      this.emit("idle");
      return;
    }
    if (!this.online) {
      this.emit("offline");
      return;
    }
    if (this.trailing && retryKind === "none") {
      this.trailing = false;
      this.start("autosave");
      return;
    }
    if (isComposerAutosaveRetryable(retryKind)) {
      this.scheduleRetry(retryKind);
      return;
    }
    this.retryDueAt = null;
    const now = this.clock.now();
    this.firstDirtyAt ??= now;
    this.lastEditAt ??= now;
    const dueAt = Math.min(
      this.lastEditAt + COMPOSER_AUTOSAVE_IDLE_MS,
      this.firstDirtyAt + COMPOSER_AUTOSAVE_MAX_WAIT_MS,
    );
    this.arm(dueAt, "scheduled");
  }
  private scheduleRetry(kind: ComposerDraftRetryKind): void {
    const now = this.clock.now(); this.failureCount = Math.max(1, this.failureCount);
    if (this.retryDueAt === null || this.retryKind !== kind) {
      this.retryDueAt = now + composerAutosaveRetryDelay(
        this.failureCount,
      );
    }
    this.retryKind = kind;
    this.arm(this.retryDueAt, "backoff");
  }
  private arm(dueAt: number, phase: ComposerAutosavePhase): void {
    const delay = Math.max(0, dueAt - this.clock.now());
    this.emit(phase, dueAt);
    this.timer = this.clock.setTimeout(() => {
      this.timer = null;
      const input = this.input;
      if (!input || !input.enabled || !this.online || input.paused) {
        this.schedule();
        return;
      }
      const kind = input.retryKind === "reconcile" ||
        this.retryKind === "reconcile" ? "reconcile" : "autosave";
      this.start(kind);
    }, delay);
  }
  private start(kind: "autosave" | "reconcile"): void {
    const input = this.input;
    if (!input || this.inFlight) return;
    const retryKind = input.retryKind === "none" ? this.retryKind : input.retryKind;
    if (!canComposerAutosaveRun(input, this.online, retryKind)) {
      this.schedule();
      return;
    }
    if (kind === "autosave" && !input.hasUserEdits) {
      this.schedule();
      return;
    }
    this.cancelTimer();
    this.inFlight = true;
    this.activeGeneration = kind === "reconcile"
      ? this.reconciliationGeneration ?? input.contentGeneration
      : input.contentGeneration;
    this.retryDueAt = null;
    this.emit("saving");
    const action = kind === "reconcile" ? input.reconcile : input.autosave;
    const epoch = this.epoch;
    void Promise.resolve().then(action).then(
      (success) => this.settle(kind, success, epoch),
      () => this.settle(kind, false, epoch),
    );
  }
  private settle(
    kind: "autosave" | "reconcile",
    success: boolean,
    epoch: number,
  ): void {
    if (epoch !== this.epoch) return;
    const input = this.input;
    const generation = this.activeGeneration;
    this.inFlight = false;
    this.activeGeneration = null;
    if (!success) {
      this.failureCount += 1;
      if (kind === "autosave") this.reconciliationGeneration = generation;
      if (kind === "autosave" && input?.retryKind === "none") this.retryKind = "blocked";
      this.awaitingRefresh = false;
      this.schedule();
      return;
    }
    this.failureCount = 0; this.reconciliationGeneration = null;
    this.retryKind = "none";
    if (input && generation !== null && input.contentGeneration !== generation) {
      this.trailing = true;
    }
    this.awaitingRefresh = true;
    this.waitForUpdateAfter = this.updateSequence;
    this.cancelTimer();
    this.emit("idle");
  }
  private resetSchedule(): void {
    this.cancelTimer();
    this.resetDirtyWindow();
    this.retryDueAt = null;
    this.retryKind = "none";
    this.failureCount = 0;
    this.reconciliationGeneration = null;
    this.trailing = false;
    this.awaitingRefresh = false;
  }
  private resetDirtyWindow(): void { this.firstDirtyAt = null; this.lastEditAt = null; }
  private cancelTimer(): void {
    if (this.timer === null) return;
    this.clock.clearTimeout(this.timer); this.timer = null;
  }
  private emit(
    phase: ComposerAutosavePhase,
    nextAttemptAt: number | null = null,
  ): void {
    this.onStatus({ isOnline: this.online, nextAttemptAt, phase,
      retryAttempt: this.failureCount });
  }
}
