import { beforeEach, describe, expect, it, vi } from "vitest";
import { MEMBER_SESSION_RECOVERY_PURGE_ERROR } from "@/presentation/features/mail-workspace/member-session-recovery";
const hooks = vi.hoisted(() => {
  const initialized = new Set<number>();
  const values: unknown[] = [];
  const layoutDependencies: (readonly unknown[] | undefined)[] = [];
  let stateCursor = 0;
  let layoutCursor = 0;
  return {
    begin: () => { stateCursor = 0; layoutCursor = 0; },
    reset: () => {
      initialized.clear(); values.length = 0; layoutDependencies.length = 0;
      stateCursor = 0; layoutCursor = 0;
    },
    useLayoutEffect: (
      effect: () => void,
      dependencies?: readonly unknown[],
    ) => {
      const index = layoutCursor++;
      const previous = layoutDependencies[index];
      const changed = !previous || !dependencies ||
        previous.length !== dependencies.length ||
        dependencies.some((value, item) => value !== previous[item]);
      if (changed) { layoutDependencies[index] = dependencies; effect(); }
    },
    useRef: <T,>(initial: T): { current: T } => {
      const index = stateCursor++;
      if (!initialized.has(index)) {
        initialized.add(index); values[index] = { current: initial };
      }
      return values[index] as { current: T };
    },
    useState: <T,>(initial: T) => {
      const index = stateCursor++;
      if (!initialized.has(index)) {
        initialized.add(index); values[index] = initial;
      }
      return [
        values[index] as T,
        (next: T) => { values[index] = next; },
      ] as const;
    },
  };
});
const api = vi.hoisted(() => ({ signOut: vi.fn() }));
const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
const revocationBus = vi.hoisted(() => ({ publish: vi.fn(),
  subscribe: vi.fn(() => () => undefined) }));
const lifecycle = vi.hoisted(() => {
  let revoke: ((event: {
    eventId: string; issuedAt: number; reason: "expired" | "invalidated" | "signed-out";
    sessionScope: string; version: 1;
  }) => void) | null = null;
  return {
    emit: (sessionScope: string, reason: "expired" | "invalidated" | "signed-out" = "signed-out") =>
      revoke?.({ eventId: crypto.randomUUID(), issuedAt: Date.now(), reason,
        sessionScope, version: 1 }),
    register: (callback: typeof revoke) => { revoke = callback; },
    reset: () => { revoke = null; },
  };
});
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCallback: <T,>(callback: T): T => callback,
  useLayoutEffect: hooks.useLayoutEffect,
  useRef: hooks.useRef,
  useState: hooks.useState,
}));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/transport/client/api-client", () => ({
  memberSessionApi: { signOut: api.signOut },
}));
vi.mock(
  "@/presentation/features/mail-workspace/hooks/use-member-session-revocation",
  () => ({
    useMemberSessionRevocation: ({ onRevoke }: {
      readonly onRevoke: Parameters<typeof lifecycle.register>[0];
    }) => lifecycle.register(onRevoke),
  }),
);
import { useMemberSessionModel } from "@/presentation/features/mail-workspace/hooks/use-member-session-model";
import type { MemberSessionRecoveryPurger } from "@/presentation/features/mail-workspace/member-session-recovery";

const render = (
  scope: string,
  purgeRecovery: MemberSessionRecoveryPurger,
  requiresConfirmation = false,
) => {
  hooks.begin();
  return useMemberSessionModel({
    canSignOut: true, handleSessionFailure: () => false, purgeRecovery,
    requiresConfirmation, revocationBus,
    sessionScope: scope, signOutPath: "/member/sign-in",
  });
};
beforeEach(() => {
  hooks.reset(); api.signOut.mockReset(); lifecycle.reset(); revocationBus.publish.mockReset();
  revocationBus.subscribe.mockClear(); router.replace.mockReset(); router.refresh.mockReset();
});
describe("member sign-out recovery lifecycle", () => {
  it("purges and redirects when server invalidation clears scope before broadcast", async () => {
    const purgeRecovery = vi.fn().mockResolvedValue(undefined); render("scope-a", purgeRecovery); render("", purgeRecovery);
    await Promise.resolve(); await Promise.resolve();
    expect(purgeRecovery).toHaveBeenCalledWith("scope-a"); expect(router.replace).toHaveBeenCalledWith("/member/sign-in");
    expect(router.refresh).toHaveBeenCalledOnce();
  });
  it("requires explicit confirmation before purging unsaved recovery", async () => {
    const purgeRecovery = vi.fn().mockResolvedValue(undefined);
    api.signOut.mockResolvedValue(undefined);
    await render("scope-a", purgeRecovery, true).onSignOut();
    const confirmation = render("scope-a", purgeRecovery, true).confirmation;
    expect(confirmation.isOpen).toBe(true);
    expect(api.signOut).not.toHaveBeenCalled();
    await confirmation.onConfirm();
    expect(api.signOut).toHaveBeenCalledWith("scope-a");
    expect(purgeRecovery).toHaveBeenCalledWith("scope-a");
    expect(revocationBus.publish).toHaveBeenCalledWith("scope-a", "signed-out");
  });

  it("redirects only after the exact scope purge completes", async () => {
    const pending = Promise.withResolvers<void>();
    const purgeRecovery = vi.fn().mockReturnValue(pending.promise);
    api.signOut.mockResolvedValue(undefined);
    const request = render("scope-a", purgeRecovery).onSignOut();
    await Promise.resolve();
    expect(api.signOut).toHaveBeenCalledWith("scope-a");
    expect(purgeRecovery).toHaveBeenCalledWith("scope-a");
    expect(router.replace).not.toHaveBeenCalled();
    const privateModel = render("scope-a", purgeRecovery);
    expect(privateModel.privacyCurtain).toMatchObject({
      error: null, isOpen: true, isPurging: true,
    });

    pending.resolve();
    await request;
    expect(router.replace).toHaveBeenCalledWith("/member/sign-in");
    expect(router.refresh).toHaveBeenCalledOnce();
  });

  it("hides the signed-out mailbox and retries only the captured cleanup", async () => {
    const purgeRecovery = vi.fn().mockRejectedValue(
      new Error(MEMBER_SESSION_RECOVERY_PURGE_ERROR),
    );
    api.signOut.mockResolvedValue(undefined);

    await render("scope-a", purgeRecovery).onSignOut();
    const model = render("scope-a", purgeRecovery);

    expect(router.replace).not.toHaveBeenCalled();
    expect(model.error).toBeNull();
    expect(model.isSigningOut).toBe(false);
    expect(model.canSignOut).toBe(false);
    expect(model.privacyCurtain).toMatchObject({
      error: MEMBER_SESSION_RECOVERY_PURGE_ERROR,
      isOpen: true,
      isPurging: false,
    });

    purgeRecovery.mockResolvedValueOnce(undefined);
    await model.privacyCurtain.onRetryCleanup();

    expect(api.signOut).toHaveBeenCalledOnce();
    expect(revocationBus.publish).toHaveBeenCalledOnce();
    expect(purgeRecovery).toHaveBeenCalledTimes(2);
    expect(purgeRecovery).toHaveBeenNthCalledWith(2, "scope-a");
    expect(router.replace).toHaveBeenCalledWith("/member/sign-in");
    expect(router.refresh).toHaveBeenCalledOnce();
  });

  it("does not purge if server sign-out fails", async () => {
    const purgeRecovery = vi.fn().mockResolvedValue(undefined);
    api.signOut.mockRejectedValue(new Error("Server sign-out failed."));
    await render("scope-a", purgeRecovery, true).onSignOut();
    await render("scope-a", purgeRecovery, true).confirmation.onConfirm();
    let model = render("scope-a", purgeRecovery, true);

    expect(purgeRecovery).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    expect(model.error).toBe("Server sign-out failed.");
    expect(model.privacyCurtain.isOpen).toBe(false);
    expect(model.canSignOut).toBe(true);
    expect(revocationBus.publish).not.toHaveBeenCalled();

    api.signOut.mockResolvedValueOnce(undefined);
    await model.onSignOut();
    model = render("scope-a", purgeRecovery, true);
    await model.confirmation.onConfirm();
    expect(api.signOut).toHaveBeenCalledTimes(2);
    expect(purgeRecovery).toHaveBeenCalledOnce();
    expect(router.replace).toHaveBeenCalledWith("/member/sign-in");
  });

  it("purges captured scope A but never redirects a newer scope B", async () => {
    const pending = Promise.withResolvers<void>();
    api.signOut.mockReturnValueOnce(pending.promise);
    const purgeRecovery = vi.fn().mockResolvedValue(undefined);
    const request = render("scope-a", purgeRecovery).onSignOut();

    render("scope-b", purgeRecovery);
    pending.resolve();
    await request;

    expect(purgeRecovery).toHaveBeenCalledWith("scope-a");
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("curtains only a matching cross-tab scope without repeating DELETE", async () => {
    const pending = Promise.withResolvers<void>();
    const purgeRecovery = vi.fn().mockReturnValue(pending.promise);
    render("scope-a", purgeRecovery);

    lifecycle.emit("scope-b", "invalidated");
    expect(purgeRecovery).not.toHaveBeenCalled();
    lifecycle.emit("scope-a", "invalidated");
    await Promise.resolve();

    expect(api.signOut).not.toHaveBeenCalled();
    expect(purgeRecovery).toHaveBeenCalledWith("scope-a");
    expect(render("scope-a", purgeRecovery).privacyCurtain).toMatchObject({
      error: null, isOpen: true, isPurging: true,
    });
    pending.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(router.replace).toHaveBeenCalledWith("/member/sign-in");
  });

  it("runs old and new scope cleanups independently", async () => {
    const pendingA = Promise.withResolvers<void>();
    const pendingB = Promise.withResolvers<void>();
    const purgeRecovery = vi.fn((scope: string) =>
      scope === "scope-a" ? pendingA.promise : pendingB.promise);
    api.signOut.mockResolvedValue(undefined);

    const requestA = render("scope-a", purgeRecovery).onSignOut();
    await Promise.resolve();
    const requestB = render("scope-b", purgeRecovery).onSignOut();
    await Promise.resolve();

    expect(purgeRecovery).toHaveBeenCalledWith("scope-a");
    expect(purgeRecovery).toHaveBeenCalledWith("scope-b");
    pendingB.resolve();
    await requestB;
    expect(router.replace).toHaveBeenCalledOnce();
    pendingA.resolve();
    await requestA;
    expect(router.replace).toHaveBeenCalledOnce();
  });
});
