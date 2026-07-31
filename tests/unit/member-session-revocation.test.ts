import { afterEach, describe, expect, it, vi } from "vitest";

import { scheduleMemberSessionExpiry } from "@/presentation/features/mail-workspace/hooks/use-member-session-revocation";
import { createBrowserMemberSessionRevocationBus } from "@/presentation/features/mail-workspace/member-session-revocation";

class FakeBroadcastChannel {
  private static readonly channels = new Set<FakeBroadcastChannel>();
  private readonly listeners = new Set<(event: MessageEvent) => void>();

  public constructor(public readonly name: string) {
    FakeBroadcastChannel.channels.add(this);
  }

  public addEventListener(
    type: string,
    listener: (event: MessageEvent) => void,
  ): void {
    if (type === "message") this.listeners.add(listener);
  }

  public postMessage(data: unknown): void {
    for (const channel of FakeBroadcastChannel.channels) {
      if (channel !== this && channel.name === this.name) {
        for (const listener of channel.listeners) {
          listener({ data } as MessageEvent);
        }
      }
    }
  }

  public static reset(): void {
    FakeBroadcastChannel.channels.clear();
  }
}

const fakeWindow = (): Window => ({
  addEventListener: vi.fn(),
  localStorage: {
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
} as unknown as Window);

afterEach(() => {
  FakeBroadcastChannel.reset();
  vi.unstubAllGlobals();
});

describe("member session revocation", () => {
  it("broadcasts an exact scope to other tabs but not the sender", () => {
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
    const first = createBrowserMemberSessionRevocationBus(fakeWindow());
    const second = createBrowserMemberSessionRevocationBus(fakeWindow());
    const firstListener = vi.fn();
    const secondListener = vi.fn();
    first.subscribe(firstListener);
    second.subscribe(secondListener);

    first.publish("scope-a", "signed-out");

    expect(firstListener).not.toHaveBeenCalled();
    expect(secondListener).toHaveBeenCalledWith(expect.objectContaining({
      reason: "signed-out", sessionScope: "scope-a", version: 1,
    }));
  });

  it("fails closed immediately for an invalid or elapsed server expiry", () => {
    const onExpire = vi.fn();
    const schedule = vi.fn();

    scheduleMemberSessionExpiry({
      expiresAt: "invalid",
      now: () => 100,
      onExpire,
      schedule,
    });

    expect(onExpire).toHaveBeenCalledOnce();
    expect(schedule).not.toHaveBeenCalled();
  });

  it("arms against the server timestamp and supports cancellation", () => {
    let now = 100;
    let callback: () => void = () => undefined;
    const cancelTimer = vi.fn();
    const schedule = vi.fn((next: () => void) => {
      callback = next;
      return cancelTimer;
    });
    const onExpire = vi.fn();
    const cancel = scheduleMemberSessionExpiry({
      expiresAt: new Date(1_100).toISOString(),
      now: () => now,
      onExpire,
      schedule,
    });

    expect(schedule).toHaveBeenCalledWith(expect.any(Function), 1_000);
    now = 1_100;
    callback();
    expect(onExpire).toHaveBeenCalledOnce();
    cancel();
    expect(cancelTimer).toHaveBeenCalledOnce();
  });
});
