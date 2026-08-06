import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ append: vi.fn() }));
vi.mock("@/server/security-audit/security-audit", () => ({
  appendSecurityAudit: mocks.append,
}));

import { securityAuditOperation } from "@/server/security-audit/security-audit-operation";

const create = () => securityAuditOperation({
  action: "messages.destroyed",
  actor: { actorId: "actor", actorType: "member" },
  count: 3,
  targetType: "messages",
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.append.mockResolvedValue(undefined);
});

describe("security audit operation lifecycle", () => {
  it("durably records attempt before success", async () => {
    const audit = create();
    await audit.attempt();
    audit.applied();
    await audit.success(2);
    expect(mocks.append.mock.calls.map(([event]) => event.outcome))
      .toEqual(["attempt", "success"]);
    expect(mocks.append.mock.calls[1]?.[0]).toMatchObject({ count: 2 });
    await audit.failureIfPending();
    expect(mocks.append).toHaveBeenCalledTimes(2);
  });

  it("records failure when the protected mutation did not apply", async () => {
    const audit = create();
    await audit.attempt();
    await audit.failureIfPending();
    expect(mocks.append.mock.calls.map(([event]) => event.outcome))
      .toEqual(["attempt", "failure"]);
  });

  it("records partial when persistence succeeded but completion did not", async () => {
    const audit = create();
    await audit.attempt();
    audit.applied();
    await audit.failureIfPending();
    expect(mocks.append.mock.calls.map(([event]) => event.outcome))
      .toEqual(["attempt", "partial"]);
  });

  it("never claims an attempt when its durable append fails", async () => {
    mocks.append.mockRejectedValueOnce(new Error("store unavailable"));
    const audit = create();
    await expect(audit.attempt()).rejects.toThrow("store unavailable");
    await audit.failureIfPending();
    expect(mocks.append).toHaveBeenCalledOnce();
  });
});
