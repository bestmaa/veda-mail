import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ effect: null as null | (() => void | (() => void)) }));
vi.mock("react", () => ({ useEffect: (effect: typeof state.effect) => { state.effect = effect; } }));
import { PwaRegistration } from "@/presentation/shared/pwa/pwa-registration";

class FakeWindow extends EventTarget {}
const register = vi.fn(async () => undefined);

beforeEach(() => {
  state.effect = null;
  register.mockClear();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubGlobal("document", { readyState: "loading" });
  vi.stubGlobal("navigator", { serviceWorker: { register } });
  vi.stubGlobal("window", new FakeWindow());
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("PWA registration", () => {
  it("registers after load with root scope and bypasses HTTP worker cache", () => {
    PwaRegistration();
    const cleanup = state.effect?.();
    expect(register).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("load"));
    expect(register).toHaveBeenCalledWith("/sw.js", {
      scope: "/", updateViaCache: "none",
    });
    cleanup?.();
  });

  it("does not register in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    PwaRegistration();
    state.effect?.();
    window.dispatchEvent(new Event("load"));
    expect(register).not.toHaveBeenCalled();
  });
});
