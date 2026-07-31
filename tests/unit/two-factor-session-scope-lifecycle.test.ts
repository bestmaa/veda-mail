import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MemberTwoFactorEnrollment } from "@/domain/member/member-settings";

const hooks = vi.hoisted(() => {
  const initialized = new Set<number>();
  const values: unknown[] = [];
  const layoutDependencies: (readonly unknown[] | undefined)[] = [];
  let stateCursor = 0;
  let layoutCursor = 0;
  return {
    begin: () => {
      stateCursor = 0;
      layoutCursor = 0;
    },
    reset: () => {
      initialized.clear();
      values.length = 0;
      layoutDependencies.length = 0;
      stateCursor = 0;
      layoutCursor = 0;
    },
    useLayoutEffect: (
      effect: () => void,
      dependencies?: readonly unknown[],
    ) => {
      const index = layoutCursor++;
      const previous = layoutDependencies[index];
      const changed =
        !previous ||
        !dependencies ||
        previous.length !== dependencies.length ||
        dependencies.some((value, item) => value !== previous[item]);
      if (changed) {
        layoutDependencies[index] = dependencies;
        effect();
      }
    },
    useRef: <T,>(initial: T): { current: T } => {
      const index = stateCursor++;
      if (!initialized.has(index)) {
        initialized.add(index);
        values[index] = { current: initial };
      }
      return values[index] as { current: T };
    },
    useState: <T,>(initial: T | (() => T)) => {
      const index = stateCursor++;
      if (!initialized.has(index)) {
        initialized.add(index);
        values[index] =
          typeof initial === "function" ? (initial as () => T)() : initial;
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
  confirm: vi.fn(),
  disable: vi.fn(),
  start: vi.fn(),
}));

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCallback: <T,>(callback: T): T => callback,
  useLayoutEffect: hooks.useLayoutEffect,
  useRef: hooks.useRef,
  useState: hooks.useState,
}));

vi.mock("@/transport/client/api-client", () => ({
  memberTwoFactorApi: api,
}));

import { useTwoFactorSettingsModel } from "@/presentation/features/mail-workspace/hooks/use-two-factor-settings-model";

const render = (sessionScope: string) => {
  hooks.begin();
  return useTwoFactorSettingsModel(sessionScope);
};

beforeEach(() => {
  hooks.reset();
  api.confirm.mockReset();
  api.disable.mockReset();
  api.start.mockReset();
});

describe("two-factor session scope lifecycle", () => {
  it("clears state and ignores an account A enrollment after scope B", async () => {
    const pending =
      Promise.withResolvers<{ enrollment: MemberTwoFactorEnrollment }>();
    api.start.mockReturnValueOnce(pending.promise);
    let model = render("scope-a");

    model.view.startEnrollment();
    model = render("scope-a");
    expect(model.view.isSaving).toBe(true);
    expect(api.start).toHaveBeenCalledWith("scope-a");

    render("scope-b");
    model = render("scope-b");
    expect(model.view.enrollment).toBeNull();
    expect(model.view.isSaving).toBe(false);

    pending.resolve({
      enrollment: {
        qrDataUrl: "data:image/png;base64,account-a-secret",
        secret: "ACCOUNT-A-SECRET",
      },
    });
    await pending.promise;
    await Promise.resolve();
    model = render("scope-b");

    expect(model.view.enrollment).toBeNull();
    expect(model.view.isSaving).toBe(false);
  });
});
