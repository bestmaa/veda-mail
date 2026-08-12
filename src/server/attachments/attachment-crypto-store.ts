import "server-only";

import {
  createCipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { link, mkdir, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { iterateAttachmentBody } from "@/server/attachments/attachment-body";
import { decryptEncryptedAttachment } from
  "@/server/attachments/attachment-crypto-decrypt";
import {
  attachmentCryptoAad,
  attachmentCryptoFinalName,
  ATTACHMENT_CRYPTO_IV_BYTES,
  ATTACHMENT_CRYPTO_MAGIC,
  safeAttachmentCryptoPath,
  writeAttachmentCryptoBuffer,
} from "@/server/attachments/attachment-crypto-format";
import { assertAttachmentId } from "@/server/attachments/attachment-security";
import type {
  AttachmentBody,
  AttachmentScanner,
  AttachmentScanResult,
} from "@/server/attachments/attachment-types";
import { AttachmentQuarantineError } from "@/server/attachments/attachment-types";

const SAMPLE_BYTES = 8192;
interface EncryptedUpload {
  readonly finalName: string;
  readonly sample: Uint8Array;
  readonly scanResult: AttachmentScanResult;
  readonly sha256: string;
  readonly temporaryPath: string;
}

interface WriteOptions {
  readonly abort: () => void;
  readonly attachmentId: string;
  readonly body: AttachmentBody;
  readonly directory: string;
  readonly expectedBytes: number;
  readonly key: Buffer;
  readonly maximumBytes: number;
  readonly onProgress: () => void;
  readonly scanner: AttachmentScanner;
  readonly signal: AbortSignal;
}

export const writeEncryptedUpload = async (
  options: WriteOptions,
): Promise<EncryptedUpload> => {
  assertAttachmentId(options.attachmentId);
  const directory = path.resolve(options.directory);
  await mkdir(directory, { mode: 0o700, recursive: true });
  const temporaryPath = path.join(
    directory,
    `.attachment-${options.attachmentId}-${randomBytes(12).toString("hex")}.tmp`,
  );
  const handle = await open(temporaryPath, "wx", 0o600);
  const iv = randomBytes(ATTACHMENT_CRYPTO_IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", options.key, iv);
  cipher.setAAD(
    attachmentCryptoAad(options.attachmentId, options.expectedBytes),
  );
  const hash = createHash("sha256");
  const samples: Buffer[] = [];
  let sampledBytes = 0;
  let observedBytes = 0;
  let position = 0;
  let completed = false;
  let failed = false;
  try {
    position = await writeAttachmentCryptoBuffer(
      handle,
      Buffer.concat([ATTACHMENT_CRYPTO_MAGIC, iv]),
      position,
    );
    const inspectedContent = async function* (): AsyncGenerator<Uint8Array> {
      for await (const value of iterateAttachmentBody(
        options.body,
        options.signal,
      )) {
        if (!(value instanceof Uint8Array)) {
          throw new AttachmentQuarantineError(
            "Attachment body contains an invalid chunk.",
            "INVALID_ATTACHMENT_BODY",
            400,
          );
        }
        const chunk = Buffer.from(value);
        if (chunk.byteLength === 0) {
          continue;
        }
        if (
          chunk.byteLength >
          Math.min(
            options.maximumBytes - observedBytes,
            options.expectedBytes - observedBytes,
          )
        ) {
          throw new AttachmentQuarantineError(
            "Attachment body does not match Content-Length.",
            "ATTACHMENT_LENGTH_MISMATCH",
            400,
          );
        }
        observedBytes += chunk.byteLength;
        options.onProgress();
        hash.update(chunk);
        if (sampledBytes < SAMPLE_BYTES) {
          const sample = chunk.subarray(
            0,
            Math.min(chunk.byteLength, SAMPLE_BYTES - sampledBytes),
          );
          samples.push(Buffer.from(sample));
          sampledBytes += sample.byteLength;
        }
        position = await writeAttachmentCryptoBuffer(
          handle,
          cipher.update(chunk),
          position,
        );
        yield chunk;
      }
      if (observedBytes !== options.expectedBytes) {
        throw new AttachmentQuarantineError(
          "Attachment body does not match Content-Length.",
          "ATTACHMENT_LENGTH_MISMATCH",
          400,
        );
      }
      position = await writeAttachmentCryptoBuffer(
        handle,
        cipher.final(),
        position,
      );
      position = await writeAttachmentCryptoBuffer(
        handle,
        cipher.getAuthTag(),
        position,
      );
      await handle.sync();
      completed = true;
    };
    const scanResult = await options.scanner.scan(inspectedContent(), {
      abortUpload: options.abort,
      attachmentId: options.attachmentId,
      expectedBytes: options.expectedBytes,
      signal: options.signal,
    });
    if (!completed) {
      throw new AttachmentQuarantineError(
        "Attachment scanner did not inspect the complete upload.",
        "ATTACHMENT_SCAN_INCOMPLETE",
        503,
      );
    }
    return {
      finalName: attachmentCryptoFinalName(options.attachmentId),
      sample: Buffer.concat(samples),
      scanResult,
      sha256: hash.digest("hex"),
      temporaryPath,
    };
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    await handle.close().catch(() => undefined);
    if (failed) {
      await unlink(temporaryPath).catch(() => undefined);
    }
  }
};

export const commitEncryptedUpload = async (
  directory: string,
  upload: EncryptedUpload,
): Promise<string> => {
  const destination = safeAttachmentCryptoPath(
    path.resolve(directory),
    upload.finalName,
  );
  await link(upload.temporaryPath, destination);
  try {
    await unlink(upload.temporaryPath);
  } catch (error) {
    await unlink(destination).catch(() => undefined);
    throw error;
  }
  return upload.finalName;
};

export const discardEncryptedUpload = async (
  upload: EncryptedUpload,
): Promise<void> => {
  await unlink(upload.temporaryPath).catch(() => undefined);
};

export const deleteEncryptedAttachment = async (
  directory: string,
  name: string | undefined,
): Promise<void> => {
  if (!name) {
    return;
  }
  const target = safeAttachmentCryptoPath(path.resolve(directory), name);
  await unlink(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") {
      throw error;
    }
  });
};

export const readEncryptedAttachment = async (
  directory: string,
  name: string,
  attachmentId: string,
  expectedBytes: number,
  key: Buffer,
): Promise<Buffer> => {
  assertAttachmentId(attachmentId);
  const contents = await readFile(
    safeAttachmentCryptoPath(path.resolve(directory), name),
  );
  return decryptEncryptedAttachment(
    contents, attachmentId, expectedBytes, key,
  );
};
