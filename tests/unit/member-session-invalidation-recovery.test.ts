import { beforeEach, describe, expect, it, vi } from "vitest";

const recovery = vi.hoisted(() => ({ purge: vi.fn() }));

vi.mock(
  "@/presentation/features/mail-workspace/member-session-recovery",
  () => ({ purgeInvalidatedSessionRecovery: recovery.purge }),
);

import {
  api,
  ApiClientError,
  refresh,
  render,
  resetMailDataModelHarness,
  workspace,
} from "./mail-data-model-session-scope.test-support";

beforeEach(() => {
  resetMailDataModelHarness();
  recovery.purge.mockReset();
});

describe("member session invalidation recovery lifecycle", () => {
  it("purges the exact accepted scope once when authentication is lost", async () => {
    api.getWorkspace.mockResolvedValueOnce(workspace("scope-a"));
    let model = render();
    await refresh(model);
    model = render();
    const failure = new ApiClientError(
      "Reconnect this mailbox.",
      401,
      "MEMBER_SESSION_EXPIRED",
    );

    expect(model.handleSessionFailure(failure)).toBe(true);
    expect(model.handleSessionFailure(failure)).toBe(true);

    expect(recovery.purge).toHaveBeenCalledOnce();
    expect(recovery.purge).toHaveBeenCalledWith(
      "scope-a",
      expect.any(Function),
    );
    model = render();
    expect([model.workspace, model.sessionScope]).toEqual([null, ""]);
  });

  it("purges scope A exactly when workspace B replaces it", async () => {
    api.getWorkspace.mockResolvedValueOnce(workspace("scope-a"));
    let model = render();
    await refresh(model);
    model = render();
    recovery.purge.mockClear();
    api.getWorkspace.mockResolvedValueOnce(workspace("scope-b"));

    await refresh(model);
    model = render();

    expect(model.sessionScope).toBe("scope-b");
    expect(recovery.purge).toHaveBeenCalledOnce();
    expect(recovery.purge).toHaveBeenCalledWith("scope-a", expect.any(Function));
  });

  it("surfaces a local purge failure after clearing account data", async () => {
    api.getWorkspace.mockResolvedValueOnce(workspace("scope-private"));
    let model = render();
    await refresh(model);
    model = render();
    model.handleSessionFailure(
      new ApiClientError("Session expired.", 401, "MEMBER_SESSION_EXPIRED"),
    );
    const onFailure = recovery.purge.mock.calls[0]?.[1] as (
      message: string,
    ) => void;

    onFailure("Private recovery data remains on this device.");
    model = render();

    expect(model.workspace).toBeNull();
    expect(model.error).toBe(
      "Private recovery data remains on this device.",
    );
  });
});
