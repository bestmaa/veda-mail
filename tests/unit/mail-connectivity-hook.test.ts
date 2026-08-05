import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  effects: [] as Array<() => void | (() => void)>,
  setPhase: vi.fn(),
}));

vi.mock("react", () => ({
  useCallback: <T>(callback: T) => callback,
  useEffect: (effect: () => void | (() => void)) => state.effects.push(effect),
  useRef: <T>(value: T) => ({ current: value }),
  useState: <T>(initial: T | (() => T)) => [
    typeof initial === "function" ? (initial as () => T)() : initial,
    state.setPhase,
  ],
}));

import { useMailConnectivity } from "@/presentation/features/mail-workspace/hooks/use-mail-connectivity";

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

beforeEach(() => {
  state.effects = [];
  state.setPhase.mockReset();
  vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal("window", Object.assign(new EventTarget(), {
    clearTimeout: globalThis.clearTimeout,
    setTimeout: globalThis.setTimeout,
  }));
});

afterEach(() => vi.unstubAllGlobals());

describe("mail connectivity hook", () => {
  it("marks offline immediately and single-flights online reconciliation", async () => {
    let finish!: (value: boolean) => void;
    const refresh = vi.fn(() => new Promise<boolean>((resolve) => {
      finish = resolve;
    }));
    useMailConnectivity({ current: refresh });
    const cleanups = state.effects.map((effect) => effect());

    window.dispatchEvent(new Event("offline"));
    expect(state.setPhase).toHaveBeenCalledWith("offline");
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("online"));
    expect(refresh).toHaveBeenCalledOnce();
    expect(state.setPhase).toHaveBeenCalledWith("reconnecting");

    finish(true);
    await flush();
    window.dispatchEvent(new Event("online"));
    expect(refresh).toHaveBeenCalledTimes(2);
    cleanups.forEach((cleanup) => cleanup?.());
  });

  it("does not issue a retry while the browser reports offline", () => {
    vi.stubGlobal("navigator", { onLine: false });
    const refresh = vi.fn(async () => true);
    const connectivity = useMailConnectivity({ current: refresh });
    connectivity.retry();
    expect(refresh).not.toHaveBeenCalled();
    expect(state.setPhase).toHaveBeenCalledWith("offline");
  });
});
