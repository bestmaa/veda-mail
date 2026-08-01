import "server-only";

import { unlink } from "node:fs/promises";
import path from "node:path";

import type { ReceivedAttachmentScanState } from "@/server/mail/received-attachment-scan-types";

const SAFE_FILE_NAME = /^[A-Za-z0-9_-]{32}\.(?:tmp|vrs)$/;
const TERMINAL_STATES = new Set<ReceivedAttachmentScanState>([
  "consumed",
  "expired",
  "rejected",
]);

export const receivedScanIsTerminal = (
  state: ReceivedAttachmentScanState,
): boolean => TERMINAL_STATES.has(state);

export const deleteReceivedScanFile = async (
  directory: string,
  fileName: string,
): Promise<boolean> => {
  if (!fileName) return true;
  if (!SAFE_FILE_NAME.test(fileName)) return false;
  try {
    await unlink(path.join(directory, fileName));
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "ENOENT";
  }
};
