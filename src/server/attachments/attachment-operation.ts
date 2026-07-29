import "server-only";

import {
  commitEncryptedUpload,
  deleteEncryptedAttachment,
} from "@/server/attachments/attachment-crypto-store";
import type { writeEncryptedUpload } from "@/server/attachments/attachment-crypto-store";
import { AttachmentQuarantineError } from "@/server/attachments/attachment-types";

type EncryptedUpload = Awaited<ReturnType<typeof writeEncryptedUpload>>;

const abortedError = (): AttachmentQuarantineError =>
  new AttachmentQuarantineError(
    "Attachment upload was aborted.",
    "ATTACHMENT_UPLOAD_ABORTED",
    409,
  );

export const runAttachmentOperation = <T>(
  signal: AbortSignal,
  operation: () => Promise<T>,
): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    let settled = false;
    const settle = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      callback();
    };
    const abort = (): void => {
      settle(() => reject(abortedError()));
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    void Promise.resolve()
      .then(() => {
        if (signal.aborted) throw abortedError();
        return operation();
      })
      .then(
        (value) => {
          settle(() => resolve(value));
        },
        (error: unknown) => {
          settle(() => reject(error));
        },
      );
  });

export const commitAttachmentOperation = (
  signal: AbortSignal,
  directory: string,
  upload: EncryptedUpload,
): Promise<string> =>
  runAttachmentOperation(signal, async () => {
    const finalName = await commitEncryptedUpload(directory, upload);
    if (signal.aborted) {
      await deleteEncryptedAttachment(directory, finalName);
      throw abortedError();
    }
    return finalName;
  });
