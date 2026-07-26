import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock(
  "@/infrastructure/providers/stalwart-jmap/provider-url-policy",
  () => ({
    assertSafeProviderOrigin: async (value: string) => new URL(value),
  }),
);

import { StalwartOAuthClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-oauth.client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Stalwart OAuth client", () => {
  it("reports the exact MFA challenge returned by Stalwart", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ type: "mfaRequired" })),
    );

    await expect(
      StalwartOAuthClient.authenticate(
        { baseUrl: "https://mail.example.com" },
        { email: "member@example.com", password: "secret" },
      ),
    ).resolves.toEqual({ status: "mfa-required" });
  });

  it("exchanges a successful login for renewable bearer credentials", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          clientCode: "authorization-code",
          iss: "https://mail.example.com",
          type: "authenticated",
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          access_token: "access-token",
          expires_in: 3600,
          refresh_token: "refresh-token",
          token_type: "bearer",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await StalwartOAuthClient.authenticate(
      { baseUrl: "https://mail.example.com" },
      {
        email: "member@example.com",
        otpCode: "123456",
        password: "secret",
      },
    );

    expect(result).toMatchObject({
      config: {
        authType: "bearer",
        baseUrl: "https://mail.example.com",
        refreshToken: "refresh-token",
        secret: "access-token",
        username: "member@example.com",
      },
      status: "authenticated",
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject(
      { mfaToken: "123456", type: "authCode" },
    );
    expect(String(fetchMock.mock.calls[1]?.[1]?.body)).toContain(
      "grant_type=authorization_code",
    );
  });

  it("retains an existing refresh token when Stalwart does not rotate it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          access_token: "new-access-token",
          expires_in: 3600,
          token_type: "bearer",
        }),
      ),
    );

    await expect(
      StalwartOAuthClient.refresh(
        "https://mail.example.com",
        "current-refresh-token",
      ),
    ).resolves.toMatchObject({
      accessToken: "new-access-token",
      refreshToken: "current-refresh-token",
    });
  });
});
