import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/transport/http/api-error";

const mocks = vi.hoisted(() => ({
  assertRequestRateLimit: vi.fn(),
  assertSubjectRateLimit: vi.fn(),
  connection: { id: "connection-message-list-preferences" },
  getCurrentConnection: vi.fn(),
  getMailService: vi.fn(),
  mailboxOwner: vi.fn(),
  preferencesGet: vi.fn(),
  preferencesSet: vi.fn(),
}));

vi.mock("@/server/connections/connection-session", () => ({
  getCurrentConnection: mocks.getCurrentConnection,
}));
vi.mock("@/server/mail/mail-service", () => ({
  getMailService: mocks.getMailService,
}));
vi.mock("@/server/mailboxes/mailbox-http", () => ({
  mailboxOwner: mocks.mailboxOwner,
}));
vi.mock("@/server/preferences/message-list-preferences.store", () => ({
  messageListPreferencesStore: {
    get: mocks.preferencesGet,
    set: mocks.preferencesSet,
  },
}));
vi.mock("@/server/security/rate-limit", () => ({
  assertRequestRateLimit: mocks.assertRequestRateLimit,
  assertSubjectRateLimit: mocks.assertSubjectRateLimit,
}));

import { PATCH } from "@/app/api/v1/mail/preferences/route";
import { mailSessionScope } from "@/server/connections/mail-session-scope";

const origin = "https://mail.example.com";
const validPreferences = {
  confirmBeforeSend: true,
  density: "compact",
  keyboardShortcuts: true,
  showPreview: false,
  sort: "oldest",
  undoSendSeconds: 10,
} as const;
const storedPreferences = { ...validPreferences, locale: "hi-IN", timeZone: "Asia/Kolkata" } as const;
const owner = { email: "member@example.com", providerId: "stalwart-jmap" };

const request = (input: {
  readonly body?: BodyInit | null;
  readonly contentType?: string | null;
  readonly headers?: Readonly<Record<string, string>>;
  readonly origin?: string | null;
  readonly scope?: string | null;
} = {}): Request => {
  const headers = new Headers({ host: "mail.example.com" });
  if (input.contentType !== null) {
    headers.set("content-type", input.contentType ?? "application/json");
  }
  if (input.origin !== null) headers.set("origin", input.origin ?? origin);
  if (input.scope !== null) {
    headers.set(
      "x-veda-mail-session-scope",
      input.scope ?? mailSessionScope(mocks.connection),
    );
  }
  for (const [name, value] of Object.entries(input.headers ?? {})) {
    headers.set(name, value);
  }
  return new Request(`${origin}/api/v1/mail/preferences`, {
    body: input.body === undefined
      ? JSON.stringify(validPreferences)
      : input.body,
    headers,
    method: "PATCH",
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentConnection.mockResolvedValue(mocks.connection);
  mocks.getMailService.mockResolvedValue({ id: "mail-service" });
  mocks.mailboxOwner.mockResolvedValue(owner);
  mocks.preferencesGet.mockResolvedValue(storedPreferences);
  mocks.preferencesSet.mockResolvedValue(storedPreferences);
});

describe("message list preferences route", () => {
  it("authenticates, rate-limits, scopes, persists, and returns the canonical contract", async () => {
    const routeRequest = request();

    const response = await PATCH(routeRequest);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({
      data: { preferences: storedPreferences },
    });
    expect(mocks.assertRequestRateLimit).toHaveBeenCalledWith(
      routeRequest,
      "message-list-preferences",
      5_000,
      300,
      60_000,
    );
    expect(mocks.assertSubjectRateLimit).toHaveBeenCalledWith(
      "message-list-preferences",
      mocks.connection.id,
      30,
      15 * 60_000,
    );
    expect(mocks.getMailService).toHaveBeenCalledWith(mocks.connection);
    expect(mocks.mailboxOwner).toHaveBeenCalledWith({ id: "mail-service" });
    expect(mocks.preferencesSet).toHaveBeenCalledWith(owner, storedPreferences);
  });

  it.each([
    [{ origin: "https://attacker.example" }, "cross-origin Origin"],
    [{ origin: null, headers: { "sec-fetch-site": "cross-site" } }, "cross-site fetch metadata"],
  ] as const)("rejects %s before authentication or persistence", async (options, _label) => {
    void _label;
    const response = await PATCH(request(options));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_REQUEST_ORIGIN" },
    });
    expect(mocks.getCurrentConnection).not.toHaveBeenCalled();
    expect(mocks.preferencesSet).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated request before parsing or persistence", async () => {
    mocks.getCurrentConnection.mockRejectedValueOnce(new ApiError(
      "Sign in to continue.",
      "MEMBER_AUTHENTICATION_REQUIRED",
      401,
    ));

    const response = await PATCH(request());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "MEMBER_AUTHENTICATION_REQUIRED",
        message: "Sign in to continue.",
      },
    });
    expect(mocks.getMailService).not.toHaveBeenCalled();
    expect(mocks.preferencesSet).not.toHaveBeenCalled();
  });

  it.each([null, "stale-session-scope"])(
    "rejects missing or stale mailbox session scope before provider access (%s)",
    async (scope) => {
      const response = await PATCH(request({ scope }));

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "MAIL_SESSION_CHANGED" },
      });
      expect(mocks.getMailService).not.toHaveBeenCalled();
      expect(mocks.preferencesSet).not.toHaveBeenCalled();
    },
  );

  it("enforces both request and authenticated-subject rate limits", async () => {
    mocks.assertRequestRateLimit.mockImplementationOnce(() => {
      throw new ApiError("Too many requests.", "RATE_LIMITED", 429);
    });
    const requestLimited = await PATCH(request());
    expect(requestLimited.status).toBe(429);
    expect(mocks.getCurrentConnection).not.toHaveBeenCalled();

    mocks.assertSubjectRateLimit.mockImplementationOnce(() => {
      throw new ApiError("Too many requests.", "RATE_LIMITED", 429);
    });
    const subjectLimited = await PATCH(request());
    expect(subjectLimited.status).toBe(429);
    expect(mocks.getMailService).not.toHaveBeenCalled();
    expect(mocks.preferencesSet).not.toHaveBeenCalled();
  });

  it.each([
    [{ showPreview: true, sort: "newest" }, "missing density"],
    [{ density: "dense", showPreview: true, sort: "newest" }, "unknown density"],
    [{ density: "compact", showPreview: "yes", sort: "newest" }, "non-boolean preview"],
    [{ density: "compact", showPreview: true, sort: "sender" }, "unknown sort"],
    [{ ...validPreferences, undoSendSeconds: 15 }, "unsupported undo delay"],
    [{ ...validPreferences, confirmBeforeSend: "yes" }, "non-boolean confirmation"],
    [{ ...validPreferences, keyboardShortcuts: "yes" }, "non-boolean shortcuts"],
    [{ ...validPreferences, locale: "fr-FR" }, "unsupported locale"],
    [{ ...validPreferences, timeZone: "Etc/../../secret" }, "invalid time zone"],
    [{ ...validPreferences, mailboxId: "inbox-secret" }, "unknown key"],
    [null, "null body"],
    [[], "array body"],
  ] as const)("rejects a strict body with %s before provider access", async (body, _label) => {
    void _label;
    const response = await PATCH(request({ body: JSON.stringify(body) }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
    expect(mocks.getMailService).not.toHaveBeenCalled();
    expect(mocks.mailboxOwner).not.toHaveBeenCalled();
    expect(mocks.preferencesSet).not.toHaveBeenCalled();
  });

  it.each([
    [{ body: "{not-json" }, 400, "INVALID_JSON"],
    [{ body: "" }, 400, "INVALID_JSON"],
    [{ contentType: "text/plain" }, 415, "UNSUPPORTED_MEDIA_TYPE"],
    [{ body: JSON.stringify({ ...validPreferences, padding: "x".repeat(1_100) }) }, 413, "REQUEST_BODY_TOO_LARGE"],
    [{ headers: { "content-length": "1025" } }, 413, "REQUEST_BODY_TOO_LARGE"],
  ] as const)(
    "rejects malformed or oversized transport input before provider access",
    async (options, status, code) => {
      const response = await PATCH(request(options));

      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toMatchObject({ error: { code } });
      expect(mocks.getMailService).not.toHaveBeenCalled();
      expect(mocks.mailboxOwner).not.toHaveBeenCalled();
      expect(mocks.preferencesSet).not.toHaveBeenCalled();
    },
  );

  it("returns a generic no-store failure when encrypted persistence fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.preferencesSet.mockRejectedValueOnce(new Error(
      "C:/private/data/message-list-preferences.json provider secret",
    ));

    const response = await PATCH(request());

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const payload = await response.json();
    expect(payload).toEqual({
      error: {
        code: "REQUEST_FAILED",
        message: "Unable to save message list preferences.",
      },
    });
    expect(JSON.stringify(payload)).not.toContain("provider secret");
    log.mockRestore();
  });
});
