import type { ChangeEvent, FormEvent } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiClientError } from "@/transport/client/api-request";

const hooks = vi.hoisted(() => {
  const initialized = new Set<number>();
  const values: unknown[] = [];
  let cursor = 0;
  return {
    begin: () => {
      cursor = 0;
    },
    reset: () => {
      cursor = 0;
      initialized.clear();
      values.length = 0;
    },
    useCallback: <T,>(callback: T): T => {
      cursor += 1;
      return callback;
    },
    useEffect: () => {
      cursor += 1;
    },
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

const api = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCallback: hooks.useCallback,
  useEffect: hooks.useEffect,
  useRef: hooks.useRef,
  useState: hooks.useState,
}));
vi.mock("@/transport/client/admin-mail-users-api", () => ({
  adminMailUsersApi: api,
}));

import { useAdminMailUserCreateModel } from "@/presentation/features/admin-mail-users/hooks/use-admin-mail-user-create-model";

const onCreated = vi.fn();
const onError = vi.fn();
const onSuccess = vi.fn();
const onUnauthorized = vi.fn();
const render = () => {
  hooks.begin();
  return useAdminMailUserCreateModel({
    available: true,
    onCreated,
    onError,
    onSuccess,
    onUnauthorized,
    reason: null,
    requiresOtp: true,
    selectedDomain: "example.com",
  });
};
const change = (value: string): ChangeEvent<HTMLInputElement> =>
  ({ target: { value } }) as ChangeEvent<HTMLInputElement>;
const submit = (model: ReturnType<typeof render>): Promise<void> =>
  (model.onSubmit as unknown as (event: FormEvent<HTMLFormElement>) => Promise<void>)(
    { preventDefault: vi.fn() } as unknown as FormEvent<HTMLFormElement>,
  );

beforeEach(() => {
  hooks.reset();
  api.create.mockReset();
  onCreated.mockReset();
  onError.mockReset();
  onSuccess.mockReset();
  onUnauthorized.mockReset();
});

const fill = () => {
  let model = render();
  model.emailInput(change("Ada@example.com"));
  model.mailboxPasswordInput(change("MailboxPassword9"));
  model.confirmationInput(change("MailboxPassword9"));
  model.adminPasswordInput(change("WrongAdminPassword9"));
  model.otpCodeInput(change("000000"));
  model = render();
  return model;
};

describe("admin mailbox user create model authentication failures", () => {
  it("keeps a step-up rejection inline and clears every secret", async () => {
    api.create.mockRejectedValueOnce(
      new ApiClientError(
        "Administrator verification failed.",
        401,
        "ADMIN_STEP_UP_REJECTED",
      ),
    );

    await submit(fill());
    const model = render();

    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith("Administrator verification failed.");
    expect(model).toMatchObject({
      adminPassword: "",
      confirmation: "",
      mailboxPassword: "",
      otpCode: "",
    });
  });

  it("redirects only for the session-level unauthorized code", async () => {
    api.create.mockRejectedValueOnce(
      new ApiClientError("Sign in.", 401, "ADMIN_UNAUTHORIZED"),
    );

    await submit(fill());

    expect(onUnauthorized).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
  });

  it("warns when a replay keeps the first attempt's mailbox password", async () => {
    api.create.mockResolvedValueOnce({
      replayed: true,
      user: { email: "ada@example.com", id: "account-1" },
    });

    await submit(fill());

    expect(onSuccess).toHaveBeenCalledWith(
      "Mailbox was already created by the first attempt. Its original password remains active; the re-entered password was not applied.",
    );
  });

  it("preserves a Stalwart cache warning on a replay", async () => {
    api.create.mockResolvedValueOnce({
      replayed: true,
      user: { email: "ada@example.com", id: "account-1" },
      warning: "cache-invalidation-failed",
    });

    await submit(fill());

    expect(onSuccess).toHaveBeenCalledWith(
      "Mailbox was already created by the first attempt. Its original password remains active; the re-entered password was not applied. Stalwart cache refresh also failed, so sign-in may be briefly delayed.",
    );
  });
});
