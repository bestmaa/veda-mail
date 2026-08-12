import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/transport/http/api-error";

const mocks = vi.hoisted(() => ({
  withLock: vi.fn(),
}));

vi.mock("@/server/shared-state/shared-job-repository", () => ({
  sharedJobRepository: { withLock: mocks.withLock },
}));
vi.mock("@/server/shared-state/shared-state-redis", () => ({
  runSharedStateRedis: vi.fn(),
  sharedStateRedisConfigured: () => true,
  sharedStateRedisPrefix: () => "veda-mail:test",
}));

import { sharedAttachmentRepository } from
  "@/server/attachments/shared-attachment-repository";

describe("shared attachment repository failures", () => {
  beforeEach(() => vi.clearAllMocks());

  it("maps lifecycle-lock outages to the attachment boundary", async () => {
    mocks.withLock.mockRejectedValue(new ApiError(
      "jobs unavailable", "JOB_BACKEND_UNAVAILABLE", 503,
    ));
    await expect(sharedAttachmentRepository(Buffer.alloc(32)).withLock(
      async () => "unused",
    )).rejects.toMatchObject({
      code: "ATTACHMENT_STORAGE_UNAVAILABLE",
      status: 503,
    });
  });

  it("preserves application errors raised inside the lock", async () => {
    const conflict = new ApiError("conflict", "ATTACHMENT_STATE_CONFLICT", 409);
    mocks.withLock.mockRejectedValue(conflict);
    await expect(sharedAttachmentRepository(Buffer.alloc(32)).withLock(
      async () => "unused",
    )).rejects.toBe(conflict);
  });
});
