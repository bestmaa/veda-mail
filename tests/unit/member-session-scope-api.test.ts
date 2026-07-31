import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  memberSessionApi,
  memberSettingsApi,
  memberTwoFactorApi,
} from "@/transport/client/api-client";

const scope = "accepted-mailbox-session-scope";

const success = (input: RequestInfo | URL, init?: RequestInit): Response =>
  String(input).endsWith("/member/session") && init?.method === "DELETE"
    ? new Response(null, { status: 204 })
    : Response.json({ data: {} });

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(success));
});

describe("member client session scope", () => {
  it("sends the accepted scope on every account-derived operation", async () => {
    await memberSettingsApi.get(scope);
    await memberSettingsApi.updateProfile("Updated Member", scope);
    await memberSettingsApi.changePassword(
      {
        confirmPassword: "new-password",
        currentPassword: "current-password",
        newPassword: "new-password",
      },
      scope,
    );
    await memberTwoFactorApi.start(scope);
    await memberTwoFactorApi.confirm("password", "123456", scope);
    await memberTwoFactorApi.disable("password", "RECOVERY-CODE", scope);
    await memberSessionApi.signOut(scope);

    const calls = vi.mocked(fetch).mock.calls;
    expect(calls).toHaveLength(7);
    expect(
      calls.map(([, init]) =>
        new Headers(init?.headers).get("x-veda-mail-session-scope"),
      ),
    ).toEqual(Array.from({ length: 7 }, () => scope));
    expect(calls.map(([, init]) => init?.method ?? "GET")).toEqual([
      "GET",
      "PATCH",
      "PUT",
      "POST",
      "PUT",
      "DELETE",
      "DELETE",
    ]);
  });

  it("preserves a stale sign-out response code and guidance", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json(
        {
          error: {
            code: "MAIL_SESSION_CHANGED",
            message: "Mailbox session changed. Reload this page and try again.",
          },
        },
        { status: 409 },
      ),
    );

    await expect(memberSessionApi.signOut(scope)).rejects.toMatchObject({
      code: "MAIL_SESSION_CHANGED",
      message: "Mailbox session changed. Reload this page and try again.",
      status: 409,
    });
    const init = vi.mocked(fetch).mock.calls[0]?.[1];
    expect(
      new Headers(init?.headers).get("x-veda-mail-session-scope"),
    ).toBe(scope);
  });
});
