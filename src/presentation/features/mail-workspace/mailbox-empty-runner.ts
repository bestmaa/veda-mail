export interface MailboxEmptyBatchResult {
  readonly complete: boolean;
  readonly processed: number;
  readonly removed: number;
}

export const runMailboxEmptyBatches = async (input: {
  readonly emptyNextBatch: () => Promise<MailboxEmptyBatchResult>;
  readonly initial: Pick<MailboxEmptyBatchResult, "processed" | "removed">;
  readonly isCurrent: () => boolean;
  readonly onProgress: (result: MailboxEmptyBatchResult) => void;
}): Promise<MailboxEmptyBatchResult | null> => {
  let current: MailboxEmptyBatchResult = {
    complete: false,
    ...input.initial,
  };
  let mayBePreparingSnapshot = current.processed === 0 && current.removed === 0;
  while (!current.complete && input.isCurrent()) {
    const previousProcessed = current.processed;
    current = await input.emptyNextBatch();
    if (!input.isCurrent()) return null;
    input.onProgress(current);
    if (!current.complete && current.processed <= previousProcessed) {
      if (mayBePreparingSnapshot) {
        mayBePreparingSnapshot = false;
        continue;
      }
      throw new Error("Mailbox cleanup paused without making progress. Try again.");
    }
    mayBePreparingSnapshot = false;
  }
  return input.isCurrent() ? current : null;
};
