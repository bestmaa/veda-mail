import { beforeEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => {
  type Cleanup = (() => void) | undefined;
  const cleanups: Cleanup[] = [];
  const dependencies: (readonly unknown[] | undefined)[] = [];
  const initialized = new Set<number>();
  const values: unknown[] = [];
  let cursor = 0;
  const changed = (
    previous: readonly unknown[] | undefined,
    next: readonly unknown[],
  ): boolean =>
    !previous ||
    previous.length !== next.length ||
    previous.some((value, index) => !Object.is(value, next[index]));
  return {
    begin: () => {
      cursor = 0;
    },
    reset: () => {
      for (const cleanup of cleanups) cleanup?.();
      cleanups.length = 0;
      dependencies.length = 0;
      initialized.clear();
      values.length = 0;
      cursor = 0;
    },
    useCallback: <T>(callback: T): T => {
      cursor += 1;
      return callback;
    },
    useLayoutEffect: (
      effect: () => Cleanup,
      nextDependencies: readonly unknown[],
    ) => {
      const index = cursor++;
      if (!changed(dependencies[index], nextDependencies)) return;
      cleanups[index]?.();
      dependencies[index] = nextDependencies;
      cleanups[index] = effect();
    },
    useRef: <T>(initial: T): { current: T } => {
      const index = cursor++;
      if (!initialized.has(index)) {
        initialized.add(index);
        values[index] = { current: initial };
      }
      return values[index] as { current: T };
    },
    useState: <T>(initial: T) => {
      const index = cursor++;
      if (!initialized.has(index)) {
        initialized.add(index);
        values[index] = initial;
      }
      return [
        values[index] as T,
        (next: T | ((current: T) => T)) => {
          values[index] =
            typeof next === "function"
              ? (next as (current: T) => T)(values[index] as T)
              : next;
        },
      ] as const;
    },
  };
});

const api = vi.hoisted(() => ({
  getAttachmentCapability: vi.fn(),
}));

vi.mock("react", () => ({
  useCallback: hooks.useCallback,
  useLayoutEffect: hooks.useLayoutEffect,
  useRef: hooks.useRef,
  useState: hooks.useState,
}));

vi.mock("@/transport/client/api-client", () => ({
  mailApi: { getAttachmentCapability: api.getAttachmentCapability },
}));

import { useAttachmentCapability } from "@/presentation/features/mail-workspace/hooks/use-attachment-capability";

const render = (
  initialMaximum: number | null,
  sessionScope: string,
  initialSessionScope = "",
  handleSessionFailure: (error: unknown) => boolean = () => false,
) => {
  hooks.begin();
  return useAttachmentCapability(
    initialMaximum,
    sessionScope,
    initialSessionScope,
    handleSessionFailure,
  );
};

beforeEach(() => {
  hooks.reset();
  api.getAttachmentCapability.mockReset();
});

describe("attachment capability session ownership", () => {
  it("ignores an account A result after account B becomes active", async () => {
    const accountA = Promise.withResolvers<{
      maxAttachmentBytes: number | null;
      status: "available";
    }>();
    api.getAttachmentCapability
      .mockReturnValueOnce(accountA.promise)
      .mockResolvedValueOnce({
        maxAttachmentBytes: 12,
        status: "available",
      });

    const pendingA = render(18, "scope-a", "scope-a").refresh();
    expect(render(18, "scope-a", "scope-a").isRefreshing).toBe(true);

    render(18, "scope-b", "scope-a");
    let accountB = render(18, "scope-b", "scope-a");
    expect(accountB.maximum).toBeNull();
    expect(accountB.isRefreshing).toBe(false);

    accountA.resolve({
      maxAttachmentBytes: 99,
      status: "available",
    });
    await pendingA;
    accountB = render(18, "scope-b", "scope-a");
    expect(accountB.maximum).toBeNull();

    await accountB.refresh();
    accountB = render(18, "scope-b", "scope-a");
    expect(accountB.maximum).toBe(12);
    expect(api.getAttachmentCapability).toHaveBeenNthCalledWith(2, "scope-b");
  });

  it("uses the server maximum only for the exact originating scope", () => {
    render(18, "scope-a", "scope-a");
    expect(render(18, "scope-a", "scope-a").maximum).toBe(18);
    render(18, "scope-b", "scope-a");
    expect(render(18, "scope-b", "scope-a").maximum).toBeNull();
  });

  it("does not invalidate scope B for a late terminal failure from scope A", async () => {
    const accountA = Promise.withResolvers<{
      maxAttachmentBytes: number | null;
      status: "available";
    }>();
    const handleSessionFailure = vi.fn(() => true);
    api.getAttachmentCapability.mockReturnValueOnce(accountA.promise);

    const pendingA = render(
      18,
      "scope-a",
      "scope-a",
      handleSessionFailure,
    ).refresh();
    render(18, "scope-b", "scope-a", handleSessionFailure);
    accountA.reject(new Error("Late scope A failure."));
    await pendingA;

    expect(handleSessionFailure).not.toHaveBeenCalled();
    expect(
      render(18, "scope-b", "scope-a", handleSessionFailure).maximum,
    ).toBeNull();
  });
});
