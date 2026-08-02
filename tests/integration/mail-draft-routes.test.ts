import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertRequestRateLimit: vi.fn(),
  assertSubjectRateLimit: vi.fn(),
  discardDraft: vi.fn(),
  getCurrentConnection: vi.fn(),
  getDraft: vi.fn(),
  saveDraft: vi.fn(),
}));

vi.mock("@/server/connections/connection-session", () => ({
  getCurrentConnection: mocks.getCurrentConnection,
}));
vi.mock("@/server/mail/mail-service", () => ({
  getMailService: vi.fn(async () => ({
    discardDraft: mocks.discardDraft,
    getDraft: mocks.getDraft,
    saveDraft: mocks.saveDraft,
  })),
}));
vi.mock("@/server/security/rate-limit", () => ({
  assertRequestRateLimit: mocks.assertRequestRateLimit,
  assertSubjectRateLimit: mocks.assertSubjectRateLimit,
}));

import { POST } from "@/app/api/v1/mail/drafts/route";
import { DELETE, GET, PUT } from "@/app/api/v1/mail/drafts/[draftId]/route";
import {
  DraftConflictError,
  DraftContentTruncatedError,
  DraftNotFoundError,
} from "@/domain/mail/draft-errors";
import type { DraftDetail } from "@/domain/mail/draft";
import { id } from "@/domain/shared/brand";
import { mailSessionScope } from "@/server/connections/mail-session-scope";
import { ApiError } from "@/transport/http/api-error";

const origin = "https://mail.example.com";
const composeId = id.draft("11111111-1111-4111-8111-111111111111");
const providerDraftId = id.providerDraft("provider-draft-42");
const connection = {
  config: {},
  createdAt: "2026-07-31T00:00:00.000Z",
  displayName: "Draft route",
  id: id.connection("draft-route-connection"),
  providerId: id.provider("stalwart-jmap"),
};
const detail: DraftDetail = {
  composeId,
  content: { bcc: [], body: "", cc: [], subject: "", to: [] },
  hasAttachments: false,
  hasTruncatedContent: false,
  hasUncertainSubmission: false,
  id: providerDraftId,
  revision: "state-2",
  updatedAt: "2026-07-31T01:00:00.000Z",
};

const context = (draftId: string = providerDraftId) => ({
  params: Promise.resolve({ draftId }),
});
const request = (
  method: "DELETE" | "GET" | "POST" | "PUT",
  path: string,
  body?: unknown,
  options: { readonly origin?: string; readonly scope?: string | null } = {},
) => {
  const serialized = typeof body === "string" ? body : JSON.stringify(body);
  const scope = options.scope === undefined
    ? mailSessionScope(connection)
    : options.scope;
  return new Request(`${origin}${path}`, {
    ...(body === undefined ? {} : { body: serialized }),
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      host: "mail.example.com",
      origin: options.origin ?? origin,
      ...(scope === null ? {} : { "x-veda-mail-session-scope": scope }),
    },
    method,
  });
};

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.getCurrentConnection.mockResolvedValue(connection);
  mocks.getDraft.mockResolvedValue(detail);
  mocks.saveDraft.mockResolvedValue(detail);
});

describe("provider-backed draft routes", () => {
  it("creates a blank partial draft using only the compose UUID", async () => {
    const response = await POST(
      request("POST", "/api/v1/mail/drafts", {
        composeId,
        content: {},
      }),
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.saveDraft).toHaveBeenCalledWith({
      attachments: [],
      composeId,
      content: { bcc: [], body: "", cc: [], subject: "", to: [] },
    });
  });

  it("gets, canonically updates, and deletes an opaque provider draft", async () => {
    const get = await GET(
      request("GET", `/api/v1/mail/drafts/${providerDraftId}`),
      context(),
    );
    const put = await PUT(
      request("PUT", `/api/v1/mail/drafts/${providerDraftId}`, {
        composeId,
        content: {
          body: "untrusted fallback",
          htmlBody: "<p>Hello <b>team</b></p><script>private()</script>",
        },
        expectedRevision: "state-1",
      }),
      context(),
    );
    const deleted = await DELETE(
      request("DELETE", `/api/v1/mail/drafts/${providerDraftId}`, {
        expectedRevision: "state-2",
      }),
      context(),
    );

    expect([get.status, put.status, deleted.status]).toEqual([200, 200, 204]);
    expect(mocks.getDraft).toHaveBeenCalledWith(providerDraftId);
    expect(mocks.saveDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        composeId,
        content: expect.objectContaining({
          body: "Hello team",
          htmlBody: "<p>Hello <strong>team</strong></p>",
        }),
        expectedRevision: "state-1",
        providerDraftId,
      }),
    );
    expect(mocks.discardDraft).toHaveBeenCalledWith(
      providerDraftId,
      "state-2",
    );
  });

  it("preserves authentication failures without provider access", async () => {
    mocks.getCurrentConnection.mockRejectedValueOnce(
      new ApiError("Sign in with your mailbox account.", "MEMBER_SESSION_REQUIRED", 401),
    );
    const response = await GET(
      request("GET", `/api/v1/mail/drafts/${providerDraftId}`),
      context(),
    );

    expect(response.status).toBe(401);
    expect(mocks.getDraft).not.toHaveBeenCalled();
  });

  it.each([null, "stale-session-scope"])(
    "rejects missing or stale session scope %s",
    async (scope) => {
      const response = await GET(
        request("GET", `/api/v1/mail/drafts/${providerDraftId}`, undefined, {
          scope,
        }),
        context(),
      );
      expect(response.status).toBe(409);
      expect(mocks.getDraft).not.toHaveBeenCalled();
    },
  );

  it("rejects every cross-origin write before auth or JSON parsing", async () => {
    const attack = { origin: "https://attacker.example" };
    const responses = await Promise.all([
      POST(request("POST", "/api/v1/mail/drafts", "{bad", attack)),
      PUT(request("PUT", "/api/v1/mail/drafts/draft", "{bad", attack), context()),
      DELETE(request("DELETE", "/api/v1/mail/drafts/draft", "{bad", attack), context()),
    ]);

    expect(responses.map(({ status }) => status)).toEqual([403, 403, 403]);
    expect(mocks.getCurrentConnection).not.toHaveBeenCalled();
    expect(mocks.saveDraft).not.toHaveBeenCalled();
    expect(mocks.discardDraft).not.toHaveBeenCalled();
  });

  it.each([
    { content: { attachmentIds: ["upload-id"] } },
    { content: { subject: "x".repeat(999) } },
    { accountId: "attacker-account", content: {} },
  ])("rejects strict or over-limit input before provider access", async (extra) => {
    const response = await POST(
      request("POST", "/api/v1/mail/drafts", { composeId, ...extra }),
    );
    expect(response.status).toBe(400);
    expect(mocks.saveDraft).not.toHaveBeenCalled();
  });

  it("maps stale, incomplete, missing, and provider failures safely", async () => {
    mocks.saveDraft.mockRejectedValueOnce(new DraftConflictError());
    const stale = await PUT(
      request("PUT", `/api/v1/mail/drafts/${providerDraftId}`, {
        composeId,
        content: {},
        expectedRevision: "stale-state",
      }),
      context(),
    );
    mocks.saveDraft.mockRejectedValueOnce(new DraftContentTruncatedError());
    const incomplete = await PUT(
      request("PUT", `/api/v1/mail/drafts/${providerDraftId}`, {
        composeId,
        content: {},
        expectedRevision: "state-2",
      }),
      context(),
    );
    mocks.getDraft.mockRejectedValueOnce(new DraftNotFoundError());
    const missing = await GET(
      request("GET", "/api/v1/mail/drafts/wrong-draft"),
      context("wrong-draft"),
    );
    mocks.getDraft.mockRejectedValueOnce(new Error("secret provider details"));
    const failed = await GET(
      request("GET", `/api/v1/mail/drafts/${providerDraftId}`),
      context(),
    );

    expect([
      stale.status,
      incomplete.status,
      missing.status,
      failed.status,
    ]).toEqual([409, 409, 404, 503]);
    expect(JSON.stringify(await stale.json())).not.toContain("stale-state");
    await expect(incomplete.json()).resolves.toMatchObject({
      error: { code: "MAIL_DRAFT_CONTENT_TRUNCATED" },
    });
    expect(JSON.stringify(await missing.json())).not.toContain("wrong-draft");
    expect(JSON.stringify(await failed.json())).not.toContain("secret provider");
  });
});
