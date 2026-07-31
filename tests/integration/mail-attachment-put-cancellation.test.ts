import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/transport/http/api-error";

const mocks = vi.hoisted(() => ({
  capability: vi.fn(),
  upload: vi.fn(),
}));

vi.mock("@/server/connections/connection-session", () => ({
  getCurrentConnection: vi.fn(async () => ({
    id: "attachment-cancel-connection",
    providerId: "mock",
  })),
}));
vi.mock("@/server/mail/attachment-service", () => ({
  asAttachmentApiError: (error: unknown) => error,
  assertAttachmentCapability: mocks.capability,
  attachmentScope: () => ({
    connectionId: "attachment-cancel-connection",
    draftId: "2ecef714-3585-49b5-94bb-94495c881ca7",
    ownerId: "attachment-cancel-owner",
    sessionId: "attachment-cancel-session",
  }),
  attachmentService: () => ({ upload: mocks.upload }),
}));

import { PUT } from "@/app/api/v1/mail/attachments/[attachmentId]/route";
import { mailSessionScope } from "@/server/connections/mail-session-scope";

const origin = "https://mail.example.com";
const route = {
  params: Promise.resolve({ attachmentId: "safe-attachment-id" }),
};

const trackedRequest = () => {
  const cancelled = Promise.withResolvers<void>();
  const body = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled.resolve();
    },
    start(controller) {
      controller.enqueue(Buffer.from("x"));
    },
  });
  const request = new Request(`${origin}/api/v1/mail/attachments/upload`, {
    body,
    duplex: "half",
    headers: {
      "content-length": "1",
      host: "mail.example.com",
      origin,
      "x-veda-draft-id": "2ecef714-3585-49b5-94bb-94495c881ca7",
      "x-veda-mail-session-scope": mailSessionScope({
        id: "attachment-cancel-connection",
      }),
    },
    method: "PUT",
  } as RequestInit & { duplex: "half" });
  return { cancelled: cancelled.promise, request };
};

beforeEach(() => {
  mocks.capability.mockReset();
  mocks.capability.mockResolvedValue(1024);
  mocks.upload.mockReset();
});

describe("attachment PUT body cancellation", () => {
  it("cancels an unread body when capability validation rejects early", async () => {
    mocks.capability.mockRejectedValueOnce(
      new ApiError("Provider unavailable.", "CAPABILITY_UNAVAILABLE", 503),
    );
    const { cancelled, request } = trackedRequest();

    const response = await PUT(request, route);

    expect(response.status).toBe(503);
    expect(mocks.upload).not.toHaveBeenCalled();
    await expect(cancelled).resolves.toBeUndefined();
  });

  it("cancels the remaining body after an upload stream error", async () => {
    mocks.upload.mockImplementationOnce(
      async (
        _id: string,
        _scope: unknown,
        body: ReadableStream<Uint8Array>,
      ) => {
        const reader = body.getReader();
        await reader.read();
        reader.releaseLock();
        throw new ApiError("Stream failed.", "STREAM_FAILED", 400);
      },
    );
    const { cancelled, request } = trackedRequest();

    const response = await PUT(request, route);

    expect(response.status).toBe(400);
    await expect(cancelled).resolves.toBeUndefined();
  });
});
