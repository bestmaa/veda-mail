import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  let finishSlowRead: (() => void) | undefined;
  let slowReadFinished = false;
  let releasedBeforeSlowRead = false;
  const firstId = "A".repeat(32);
  const secondId = "B".repeat(32);
  const release = vi.fn(async () => {
    if (!slowReadFinished) releasedBeforeSlowRead = true;
  });
  const readClaimed = vi.fn((attachmentId: string) => {
    if (attachmentId === firstId) {
      return Promise.reject(new Error("attachment integrity failed"));
    }
    return new Promise<Buffer>((resolve) => {
      finishSlowRead = () => {
        slowReadFinished = true;
        resolve(Buffer.from("clean"));
      };
    });
  });
  return {
    firstId,
    finishSlowRead: () => finishSlowRead?.(),
    quarantine: {
      claim: vi.fn(async () => [
        {
          contentLength: 4,
          detectedMimeType: "text/plain",
          fileName: "corrupt.txt",
          id: firstId,
        },
        {
          contentLength: 5,
          detectedMimeType: "text/plain",
          fileName: "slow.txt",
          id: secondId,
        },
      ]),
      inspect: vi.fn(async () => ({ contentLength: 5 })),
      readClaimed,
      release,
    },
    readClaimed,
    release,
    releasedBeforeSlowRead: () => releasedBeforeSlowRead,
    reset: () => {
      finishSlowRead = undefined;
      slowReadFinished = false;
      releasedBeforeSlowRead = false;
    },
    secondId,
    sendMessage: vi.fn(),
  };
});

vi.mock("@/server/connections/connection-session", () => ({
  getCurrentConnection: async () => ({
    id: "read-settlement-connection",
    providerId: "mock",
  }),
}));
vi.mock("@/server/mail/attachment-service", async () => {
  const { ApiError } = await import("@/transport/http/api-error");
  return {
    asAttachmentApiError: () =>
      new ApiError(
        "Attachment storage integrity check failed.",
        "ATTACHMENT_INTEGRITY_FAILED",
        500,
      ),
    assertAttachmentCapability: async () => 18 * 1024 * 1024,
    attachmentScope: () => ({ connectionId: "test" }),
    attachmentService: () => mocks.quarantine,
  };
});
vi.mock("@/server/mail/attachment-send-memory-budget", () => ({
  attachmentSendMemoryBudget: () => ({
    acquire: async () => ({ release: vi.fn() }),
  }),
}));
vi.mock("@/server/mail/mail-service", () => ({
  getMailService: async () => ({ sendMessage: mocks.sendMessage }),
}));

import { POST } from "@/app/api/v1/mail/send/route";

const origin = "https://mail.example.com";

beforeEach(() => {
  mocks.reset();
  mocks.readClaimed.mockClear();
  mocks.release.mockClear();
  mocks.sendMessage.mockClear();
});

describe("attachment read settlement", () => {
  it("waits for every claimed read before releasing after one fails", async () => {
    const responsePromise = POST(
      new Request(`${origin}/api/v1/mail/send`, {
        body: JSON.stringify({
          attachmentIds: [mocks.firstId, mocks.secondId],
          body: "Two attachments.",
          draftId: crypto.randomUUID(),
          subject: "Read settlement",
          to: [{ email: "recipient@example.com", name: null }],
        }),
        headers: {
          "content-type": "application/json",
          host: "mail.example.com",
          origin,
        },
        method: "POST",
      }),
    );

    await vi.waitFor(() => expect(mocks.readClaimed).toHaveBeenCalledTimes(2));
    await Promise.resolve();
    expect(mocks.release).not.toHaveBeenCalled();
    mocks.finishSlowRead();

    expect((await responsePromise).status).toBe(500);
    expect(mocks.releasedBeforeSlowRead()).toBe(false);
    expect(mocks.release).toHaveBeenCalledTimes(2);
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });
});
