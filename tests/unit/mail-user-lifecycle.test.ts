import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  begin: vi.fn(), complete: vi.fn(), fail: vi.fn(), forwarding: vi.fn(),
  listSessions: vi.fn(), mutate: vi.fn(), removeForwarding: vi.fn(),
  removeSession: vi.fn(), preflight: vi.fn(),
}));
vi.mock("@/server/connections/connection-store", () => ({
  connectionStore: {
    listForOwnerAsync: mocks.listSessions,
    removeAsync: mocks.removeSession,
  },
}));
vi.mock("@/server/connections/member-session-metadata", () => ({
  memberSessionOwnerKey: vi.fn(() => "opaque-owner"),
}));
vi.mock("@/server/mail-forwarding/mail-forwarding.service", () => ({
  getManagedMailForwarding: mocks.forwarding,
  removeMailForwarding: mocks.removeForwarding,
}));
vi.mock("@/server/mail-users/mail-user-lifecycle-administration", () => ({
  mutateAdminMailUser: mocks.mutate,
  preflightAdminMailUserLifecycle: mocks.preflight,
}));
vi.mock("@/server/mail-users/mail-user-idempotency-store", () => ({
  mailUserIdempotencyStore: {
    begin: mocks.begin, complete: mocks.complete, fail: mocks.fail,
  },
}));

import { executeMailUserLifecycle } from "@/server/mail-users/mail-user-lifecycle";
import { ApiError } from "@/transport/http/api-error";

const intent = {
  domain: "example.com", email: "ada@example.com",
  operation: "delete" as const, userId: "account-1",
};
const providerResult = {
  email: intent.email, forwardingRemoved: false, outcome: "deleted" as const,
  sessionsRevoked: 0, userId: intent.userId,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fail.mockResolvedValue(undefined);
  mocks.begin.mockResolvedValue({ kind: "owner", token: "owner-token" });
  mocks.forwarding.mockResolvedValue({
    availability: "available", configuration: { sourceEmail: intent.email },
    reason: null, revision: 7,
  });
  mocks.listSessions.mockResolvedValue([
    { connection: { id: "session-1" } }, { connection: { id: "session-2" } },
  ]);
  mocks.mutate.mockResolvedValue(providerResult);
  mocks.preflight.mockResolvedValue({ email: intent.email, id: intent.userId });
  mocks.complete.mockImplementation(async (_key, _fingerprint, _token, result) => result);
});

describe("mailbox lifecycle orchestration", () => {
  it("reconciles forwarding, revokes every session, then mutates provider", async () => {
    const applied = vi.fn();
    const result = await executeMailUserLifecycle(
      crypto.randomUUID(), intent, "secret", "revision", applied,
    );
    expect(mocks.removeForwarding).toHaveBeenCalledWith(intent.email, 7);
    expect(mocks.preflight).toHaveBeenCalledBefore(mocks.removeForwarding);
    expect(mocks.removeSession).toHaveBeenCalledTimes(2);
    expect(mocks.removeForwarding).toHaveBeenCalledBefore(mocks.mutate);
    expect(mocks.removeSession).toHaveBeenCalledBefore(mocks.mutate);
    expect(result).toMatchObject({
      forwardingRemoved: true, sessionsRevoked: 2, outcome: "deleted",
    });
    expect(applied).toHaveBeenCalledTimes(4);
  });

  it("replays a durable terminal result without repeating cleanup", async () => {
    mocks.begin.mockResolvedValueOnce({ kind: "replay", result: providerResult });
    await expect(executeMailUserLifecycle(
      crypto.randomUUID(), intent, "secret", "revision",
    )).resolves.toMatchObject({ replayed: true, outcome: "deleted" });
    expect(mocks.forwarding).not.toHaveBeenCalled();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it("does not require forwarding-provider permissions when no managed entry exists", async () => {
    mocks.forwarding.mockResolvedValueOnce({ configuration: null, revision: 7 });
    await expect(executeMailUserLifecycle(
      crypto.randomUUID(), intent, "secret", "revision",
    )).resolves.toMatchObject({ forwardingRemoved: false, outcome: "deleted" });
    expect(mocks.removeForwarding).not.toHaveBeenCalled();
    expect(mocks.mutate).toHaveBeenCalledOnce();
  });

  it("preserves the retry claim if replay persistence fails after mutation", async () => {
    mocks.complete.mockRejectedValueOnce(new Error("redis unavailable"));
    await expect(executeMailUserLifecycle(
      crypto.randomUUID(), intent, "secret", "revision",
    )).rejects.toMatchObject({ code: "MAIL_USER_LIFECYCLE_OUTCOME_UNKNOWN" });
    expect(mocks.fail).toHaveBeenCalledWith(
      expect.any(String), expect.any(String), "owner-token", expect.anything(), true,
    );
  });

  it("releases the retry claim for a confirmed provider rejection", async () => {
    mocks.mutate.mockRejectedValueOnce(new Error("confirmed rejection"));
    await expect(executeMailUserLifecycle(
      crypto.randomUUID(), intent, "secret", "revision",
    )).rejects.toThrow("confirmed rejection");
    expect(mocks.fail).toHaveBeenCalledWith(
      expect.any(String), expect.any(String), "owner-token", expect.anything(), false,
    );
  });

  it("marks an ambiguous provider mutation as applied and preserves its claim", async () => {
    mocks.forwarding.mockResolvedValueOnce({ configuration: null, revision: 7 });
    mocks.listSessions.mockResolvedValueOnce([]);
    mocks.mutate.mockRejectedValueOnce(new ApiError(
      "Unknown outcome", "MAIL_USER_LIFECYCLE_OUTCOME_UNKNOWN", 409,
    ));
    const applied = vi.fn();
    await expect(executeMailUserLifecycle(
      crypto.randomUUID(), intent, "secret", "revision", applied,
    )).rejects.toMatchObject({ code: "MAIL_USER_LIFECYCLE_OUTCOME_UNKNOWN" });
    expect(applied).toHaveBeenCalledOnce();
    expect(mocks.fail).toHaveBeenCalledWith(
      expect.any(String), expect.any(String), "owner-token", expect.anything(), true,
    );
  });
});
