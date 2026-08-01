import { describe, expect, it, vi } from "vitest";

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useLayoutEffect: (effect: () => void) => effect(),
}));

import { useMemberSessionRevocation } from "@/presentation/features/mail-workspace/hooks/use-member-session-revocation";
import type { MemberSessionRevocation } from "@/presentation/features/mail-workspace/member-session-revocation";

describe("member session revocation hook", () => {
  it("revokes locally and broadcasts when the server expiry fires", () => {
    let expire: () => void = () => undefined;
    let now = 1_000;
    const bus = {
      publish: vi.fn(),
      subscribe: vi.fn(() => () => undefined),
    };
    const onRevoke = vi.fn();
    const schedule = vi.fn((callback: () => void) => {
      expire = callback;
      return () => undefined;
    });

    useMemberSessionRevocation({
      bus,
      expiresAt: new Date(2_000).toISOString(),
      now: () => now,
      onRevoke,
      schedule,
      sessionScope: "scope-a",
    });
    now = 2_000;
    expire();

    expect(onRevoke).toHaveBeenCalledWith(expect.objectContaining({
      reason: "expired", sessionScope: "scope-a",
    }));
    expect(bus.publish).toHaveBeenCalledWith("scope-a", "expired");
  });

  it("ignores a revocation for another exact scope", () => {
    let receive: (event: MemberSessionRevocation) => void = () => undefined;
    const onRevoke = vi.fn();
    useMemberSessionRevocation({
      bus: {
        publish: vi.fn(),
        subscribe: vi.fn((listener) => {
          receive = listener;
          return () => undefined;
        }),
      },
      expiresAt: "",
      onRevoke,
      sessionScope: "scope-a",
    });

    receive({
      eventId: crypto.randomUUID(), issuedAt: Date.now(), reason: "invalidated",
      sessionScope: "scope-b", version: 1,
    });
    expect(onRevoke).not.toHaveBeenCalled();
  });
});
