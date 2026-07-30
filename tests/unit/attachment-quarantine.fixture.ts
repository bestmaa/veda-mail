import type {
  AttachmentMimeDetector,
  AttachmentQuarantineOptions,
  AttachmentScanner,
  AttachmentScope,
} from "@/server/attachments";
import { createAttachmentQuarantine } from "@/server/attachments";

export const attachmentScope: AttachmentScope = {
  connectionId: "connection-private-123",
  draftId: "draft-private-123",
  ownerId: "owner@example.com",
  sessionId: "session-private-123",
};

export const otherAttachmentScope: AttachmentScope = {
  ...attachmentScope,
  ownerId: "attacker@example.com",
};

export const body = (
  ...chunks: readonly (string | Uint8Array)[]
): AsyncIterable<Uint8Array> => ({
  async *[Symbol.asyncIterator]() {
    for (const chunk of chunks) {
      yield typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    }
  },
});

export const controlledDelayedBody = (
  delayMs: number,
  ...chunks: readonly (string | Uint8Array)[]
) => {
  const gates = chunks.map(() => Promise.withResolvers<void>());
  return {
    body: {
      async *[Symbol.asyncIterator]() {
        for (const [index, chunk] of chunks.entries()) {
          gates[index]?.resolve();
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          yield typeof chunk === "string" ? Buffer.from(chunk) : chunk;
        }
      },
    },
    waiting: gates.map(({ promise }) => promise),
  };
};

export const cleanScanner = (observed?: Uint8Array[]): AttachmentScanner => ({
  async scan(content) {
    for await (const chunk of content) {
      observed?.push(Buffer.from(chunk));
    }
    return { verdict: "clean" };
  },
});

export const acceptingDetector: AttachmentMimeDetector = {
  async detect({ declaredMimeType }) {
    return { mimeType: declaredMimeType, verdict: "accepted" };
  },
};

export const quarantineFixture = (
  directory: string,
  overrides: Partial<AttachmentQuarantineOptions> = {},
) =>
  createAttachmentQuarantine({
    directory,
    encryptionKey: Buffer.alloc(32, 7),
    mimeDetector: acceptingDetector,
    scanner: cleanScanner(),
    ...overrides,
  });

export const reserveText = (
  quarantine: ReturnType<typeof quarantineFixture>,
  contentLength: number,
  scope: AttachmentScope = attachmentScope,
  fileName = "notes.txt",
) =>
  quarantine.reserve({
    contentLength,
    declaredMimeType: "text/plain",
    fileName,
    scope,
  });
