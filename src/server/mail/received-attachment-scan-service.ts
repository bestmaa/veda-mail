import "server-only";

import {
  cleanupReceivedAttachmentScanOrphans,
  createReceivedAttachmentScanDirectory,
  createReceivedAttachmentScanSpool,
  type ReceivedAttachmentScanSpool,
} from "@/server/mail/received-attachment-scan";
import { attachmentScanner } from "@/server/mail/attachment-service";

const CLEANUP_INTERVAL_MS = 60_000;

const processState = globalThis as typeof globalThis & {
  __vedaMailReceivedScanCleanup?: NodeJS.Timeout;
  __vedaMailReceivedScanSpool?: Promise<ReceivedAttachmentScanSpool>;
};

const createProcessSpool = async (): Promise<ReceivedAttachmentScanSpool> => {
  if (process.env.NODE_ENV === "production") {
    await cleanupReceivedAttachmentScanOrphans();
  }
  const directory = await createReceivedAttachmentScanDirectory();
  const spool = await createReceivedAttachmentScanSpool({
    directory,
    scanner: attachmentScanner(),
  });
  processState.__vedaMailReceivedScanCleanup = setInterval(() => {
    void spool.cleanupExpired().catch(() => {
      console.error("[veda-mail] Received attachment cleanup failed.");
    });
  }, CLEANUP_INTERVAL_MS);
  processState.__vedaMailReceivedScanCleanup.unref();
  return spool;
};

export const receivedAttachmentScanSpool = async () => {
  processState.__vedaMailReceivedScanSpool ??= createProcessSpool().catch(
    (error: unknown) => {
      delete processState.__vedaMailReceivedScanSpool;
      throw error;
    },
  );
  return processState.__vedaMailReceivedScanSpool;
};

export const resetReceivedAttachmentScanServiceForTests = async () => {
  clearInterval(processState.__vedaMailReceivedScanCleanup);
  delete processState.__vedaMailReceivedScanCleanup;
  const pending = processState.__vedaMailReceivedScanSpool;
  delete processState.__vedaMailReceivedScanSpool;
  await pending?.then((spool) => spool.dispose()).catch(() => undefined);
};
