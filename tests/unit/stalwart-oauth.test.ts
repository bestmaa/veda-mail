import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/infrastructure/providers/stalwart-jmap/provider-url-policy", () => ({
  assertSafeProviderOrigin: async (value: string) => new URL(value),
}));

import { StalwartOAuthClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-oauth.client";

const registration = {
  client_id: "registered-client-id",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Stalwart OAuth client", () => {
  it("reports the exact MFA challenge returned by Stalwart", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json(registration, { status: 201 }))
        .mockResolvedValueOnce(Response.json({ type: "mfaRequired" })),
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
      .mockResolvedValueOnce(Response.json(registration, { status: 201 }))
      .mockResolvedValueOnce(
        Response.json({
          client_code: "authorization-code",
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
        oauthClientId: "registered-client-id",
        refreshToken: "refresh-token",
        secret: "access-token",
        username: "member@example.com",
      },
      status: "authenticated",
    });
    expect(
      JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)),
    ).toMatchObject({
      clientId: "registered-client-id",
      codeChallengeMethod: "S256",
      mfaToken: "123456",
      type: "authCode",
    });
    expect(String(fetchMock.mock.calls[2]?.[1]?.body)).toContain(
      "grant_type=authorization_code",
    );
    expect(String(fetchMock.mock.calls[2]?.[1]?.body)).toContain(
      "code_verifier=",
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
        "registered-client-id",
      ),
    ).resolves.toMatchObject({
      accessToken: "new-access-token",
      clientId: "registered-client-id",
      refreshToken: "current-refresh-token",
    });
  });
});
