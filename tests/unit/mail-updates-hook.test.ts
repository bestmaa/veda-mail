import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  effect: null as null | (() => void | (() => void)),
  wait: vi.fn(),
}));

vi.mock("react", () => ({
  useEffect: (effect: () => void | (() => void)) => { state.effect = effect; },
}));
vi.mock("@/transport/client/mail-updates-api", () => ({
  mailUpdatesApi: { wait: state.wait },
}));

import { useMailUpdates } from "@/presentation/features/mail-workspace/hooks/use-mail-updates";

class FakeDocument extends EventTarget {
  public visibilityState: DocumentVisibilityState = "visible";
}

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

beforeEach(() => {
  vi.useFakeTimers();
  state.effect = null;
  state.wait.mockReset();
  const document = new FakeDocument();
  const browserWindow = Object.assign(new EventTarget(), {
    clearTimeout: globalThis.clearTimeout,
    setTimeout: globalThis.setTimeout,
  });
  vi.stubGlobal("document", document);
  vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal("window", browserWindow);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const start = (
  refresh = vi.fn(async () => true),
  handleSessionFailure = vi.fn(() => false),
) => {
  useMailUpdates(refresh, "scope-1", handleSessionFailure);
  const cleanup = state.effect?.();
  return { cleanup, handleSessionFailure, refresh };
};

describe("mail updates hook", () => {
  it("refreshes the current view after a provider state change", async () => {
    state.wait.mockResolvedValueOnce({
      mode: "push", retryAfterMs: 1_000, shouldRefresh: true,
    });
    const current = start();
    await flush();

    expect(state.wait).toHaveBeenCalledOnce();
    expect(current.refresh).toHaveBeenCalledOnce();
    current.cleanup?.();
  });

  it("does not consume provider resources while the tab is hidden", async () => {
    (document as FakeDocument).visibilityState = "hidden";
    state.wait.mockReturnValue(new Promise(() => undefined));
    const current = start();
    await flush();
    expect(state.wait).not.toHaveBeenCalled();

    (document as FakeDocument).visibilityState = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    await flush();
    expect(state.wait).toHaveBeenCalledOnce();
    current.cleanup?.();
  });

  it("waits for the bounded poll interval before refreshing IMAP", async () => {
    state.wait.mockResolvedValueOnce({
      mode: "poll", retryAfterMs: 60_000, shouldRefresh: true,
    }).mockReturnValueOnce(new Promise(() => undefined));
    const current = start();
    await flush();
    expect(current.refresh).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(59_999);
    expect(current.refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(current.refresh).toHaveBeenCalledOnce();
    current.cleanup?.();
  });

  it("remembers a state event that arrives while the tab becomes hidden", async () => {
    let deliver!: (value: unknown) => void;
    state.wait.mockReturnValueOnce(new Promise((resolve) => { deliver = resolve; }))
      .mockReturnValueOnce(new Promise(() => undefined));
    const current = start();
    await flush();
    (document as FakeDocument).visibilityState = "hidden";
    deliver({ mode: "push", retryAfterMs: 1_000, shouldRefresh: true });
    await flush();
    expect(current.refresh).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_000);
    (document as FakeDocument).visibilityState = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    await flush();
    expect(current.refresh).toHaveBeenCalledOnce();
    current.cleanup?.();
  });

  it("uses capped retry delay after a transient transport failure", async () => {
    state.wait.mockRejectedValueOnce(new Error("network down"))
      .mockReturnValueOnce(new Promise(() => undefined));
    const current = start();
    await flush();
    expect(state.wait).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(4_999);
    expect(state.wait).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(state.wait).toHaveBeenCalledTimes(2);
    expect(current.handleSessionFailure).toHaveBeenCalledOnce();
    current.cleanup?.();
  });
});
