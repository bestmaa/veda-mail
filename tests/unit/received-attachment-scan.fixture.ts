import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { AttachmentScanner } from "@/server/attachments";
import {
  createReceivedAttachmentScanSpool,
  type ReceivedAttachmentScanScope,
  type ReceivedAttachmentScanSpoolOptions,
} from "@/server/mail/received-attachment-scan";

export const receivedScope: ReceivedAttachmentScanScope = {
  attachmentId: "provider-attachment-secret",
  connectionId: "provider-connection-secret",
  messageId: "provider-message-secret",
};

export const otherReceivedScope: ReceivedAttachmentScanScope = {
  ...receivedScope,
  messageId: "different-message",
};

export const webBody = (
  ...chunks: readonly (string | Uint8Array)[]
): ReadableStream<Uint8Array> => new ReadableStream({
  start(controller) {
    for (const chunk of chunks) {
      controller.enqueue(
        typeof chunk === "string" ? Buffer.from(chunk) : chunk,
      );
    }
    controller.close();
  },
});

export const cleanReceivedScanner = (
  observed?: Uint8Array[],
): AttachmentScanner => ({
  async scan(content) {
    for await (const chunk of content) observed?.push(Buffer.from(chunk));
    return { verdict: "clean" };
  },
});

export const receivedScanFixture = async (
  overrides: Partial<ReceivedAttachmentScanSpoolOptions> = {},
) => {
  const directory = overrides.directory ?? await mkdtemp(path.join(
    os.tmpdir(),
    "veda-received-test-",
  ));
  const spool = await createReceivedAttachmentScanSpool({
    directory,
    encryptionKey: Buffer.alloc(32, 19),
    scanner: cleanReceivedScanner(),
    ...overrides,
  });
  return { directory, spool };
};

export const readWebBody = async (
  stream: ReadableStream<Uint8Array>,
): Promise<Buffer> => {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  while (true) {
    const result = await reader.read();
    if (result.done) return Buffer.concat(chunks);
    chunks.push(result.value);
  }
};
