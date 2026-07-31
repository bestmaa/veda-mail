import type { ChangeEvent } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AdminMailUsersSnapshot } from "@/transport/client/admin-mail-users-api";

const hooks = vi.hoisted(() => {
  const initialized = new Set<number>();
  const values: unknown[] = [];
  let cursor = 0;
  let effectRan = false;
  return {
    begin: () => {
      cursor = 0;
    },
    reset: () => {
      cursor = 0;
      effectRan = false;
      initialized.clear();
      values.length = 0;
    },
    useCallback: <T,>(callback: T): T => callback,
    useEffect: (effect: () => void) => {
      if (effectRan) return;
      effectRan = true;
      effect();
    },
    useMemo: <T,>(factory: () => T): T => factory(),
    useRef: <T,>(initial: T): { current: T } => {
      const index = cursor++;
      if (!initialized.has(index)) {
        initialized.add(index);
        values[index] = { current: initial };
      }
      return values[index] as { current: T };
    },
    useState: <T,>(initial: T) => {
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
  getDetail: vi.fn(),
  getSnapshot: vi.fn(),
}));
const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCallback: hooks.useCallback,
  useEffect: hooks.useEffect,
  useMemo: hooks.useMemo,
  useRef: hooks.useRef,
  useState: hooks.useState,
}));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/transport/client/admin-mail-users-api", () => ({
  adminMailUsersApi: api,
}));
vi.mock(
  "@/presentation/features/admin-mail-users/hooks/use-admin-mail-user-create-model",
  () => ({
    useAdminMailUserCreateModel: () => ({
      adminPassword: "",
      adminPasswordInput: vi.fn(),
      confirmation: "",
      confirmationInput: vi.fn(),
      displayName: "",
      displayNameInput: vi.fn(),
      domain: "",
      email: "",
      emailInput: vi.fn(),
      isAvailable: false,
      isSubmitting: false,
      mailboxPassword: "",
      mailboxPasswordInput: vi.fn(),
      onSubmit: vi.fn(),
      otpCode: "",
      otpCodeInput: vi.fn(),
      reason: null,
      requiresOtp: false,
    }),
  }),
);

import { useAdminMailUsersModel } from "@/presentation/features/admin-mail-users/hooks/use-admin-mail-users-model";

const page = (
  domain: string,
  email: string,
  nextCursor: string | null,
): AdminMailUsersSnapshot => ({
  adminTwoFactorEnabled: false,
  allowedDomains: ["old.example", "new.example"],
  creation: { available: true, reason: null },
  nextCursor,
  status: "available",
  users: [
    {
      aliases: [],
      createdAt: null,
      displayName: email,
      email,
      id: `${domain}:${email}`,
      maxDiskQuota: null,
      usedDiskQuota: 0,
    },
  ],
});
const render = () => {
  hooks.begin();
  return useAdminMailUsersModel();
};
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

beforeEach(() => {
  hooks.reset();
  api.getDetail.mockReset();
  api.getSnapshot.mockReset();
  router.replace.mockReset();
  router.refresh.mockReset();
});

describe("admin mailbox pagination and domain reload race", () => {
  it("unlocks immediately and ignores a late page from the old domain", async () => {
    const initial = Promise.withResolvers<AdminMailUsersSnapshot>();
    const oldPagination = Promise.withResolvers<AdminMailUsersSnapshot>();
    const freshDomain = Promise.withResolvers<AdminMailUsersSnapshot>();
    api.getSnapshot
      .mockReturnValueOnce(initial.promise)
      .mockReturnValueOnce(oldPagination.promise)
      .mockReturnValueOnce(freshDomain.promise);

    render();
    initial.resolve(page("old.example", "old@old.example", "next-page"));
    await flush();
    let model = render();
    expect(model.selectedDomain).toBe("old.example");

    model.onLoadMore();
    model = render();
    expect(model.isLoadingMore).toBe(true);

    model.domainInput({
      target: { value: "new.example" },
    } as ChangeEvent<HTMLSelectElement>);
    model = render();
    expect(model.isLoadingMore).toBe(false);
    expect(model.items).toEqual([]);

    oldPagination.resolve(page("old.example", "stale@old.example", null));
    await flush();
    model = render();
    expect(model.isLoadingMore).toBe(false);
    expect(model.items).toEqual([]);

    freshDomain.resolve(page("new.example", "fresh@new.example", null));
    await flush();
    model = render();
    expect(model.isLoading).toBe(false);
    expect(model.isLoadingMore).toBe(false);
    expect(model.selectedDomain).toBe("new.example");
    expect(model.items.map((item) => item.email)).toEqual([
      "fresh@new.example",
    ]);
  });
});
