import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/transport/http/api-error";

const mocks = vi.hoisted(() => ({
  configured: true,
  run: vi.fn(),
}));

vi.mock("@/server/shared-state/shared-state-redis", () => ({
  runSharedStateRedis: mocks.run,
  sharedStateRedisConfigured: () => mocks.configured,
  sharedStateRedisPrefix: () => "veda-mail:test",
}));

import { sharedOwnerRepository } from
  "@/server/shared-state/shared-owner-repository";

describe("shared owner repository failures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.configured = true;
  });

  it("maps shared Redis outages to its own availability contract", async () => {
    mocks.run.mockRejectedValue(new ApiError(
      "session unavailable", "SESSION_BACKEND_UNAVAILABLE", 503,
    ));
    await expect(sharedOwnerRepository.get(
      "message-list-preferences", "a".repeat(43),
    )).rejects.toMatchObject({
      code: "SHARED_OWNER_BACKEND_UNAVAILABLE", status: 503,
    });
  });

  it("does not invoke Redis when shared state is disabled", async () => {
    mocks.configured = false;
    await expect(sharedOwnerRepository.ensureMigrated(
      "message-list-preferences",
      async () => ({ owner: "encrypted" }),
      async () => undefined,
    )).resolves.toBe(false);
    expect(mocks.run).not.toHaveBeenCalled();
  });
});
