import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SendReceipt } from "@/domain/mail/mail";
import { id } from "@/domain/shared/brand";
import { ApiError } from "@/transport/http/api-error";

const mocks = vi.hoisted(() => ({
  assertRequestRateLimit: vi.fn(),
  assertSubjectRateLimit: vi.fn(),
  getCurrentConnection: vi.fn(),
}));

vi.mock("@/server/connections/connection-session", () => ({
  getCurrentConnection: mocks.getCurrentConnection,
}));

vi.mock("@/server/security/rate-limit", () => ({
  assertRequestRateLimit: mocks.assertRequestRateLimit,
  assertSubjectRateLimit: mocks.assertSubjectRateLimit,
}));

import { DELETE } from "@/app/api/v1/mail/delivery-notices/[deliveryNoticeId]/route";
import { GET } from "@/app/api/v1/mail/delivery-notices/route";
import { mailSessionScope } from "@/server/connections/mail-session-scope";
import { deliveryNoticeStore } from "@/server/mail/delivery-notice-store";

const origin = "https://mail.example.com";
const connectionA = id.connection("delivery-route-connection-a");
const connectionB = id.connection("delivery-route-connection-b");
const partialNoticeId = "11111111-1111-4111-8111-111111111111";
const uncertainNoticeId = "22222222-2222-4222-8222-222222222222";

const receipt = (
  deliveryNoticeId: string,
  deliveryStatus: "partial" | "uncertain",
): SendReceipt => ({
  deliveryNoticeId,
  deliveryStatus,
  id: id.message(`message-${deliveryNoticeId}`),
  rejectedRecipients:
    deliveryStatus === "partial" ? ["Rejected@Example.com"] : [],
  submittedAt: "2026-07-30T12:00:00.000Z",
});

const request = (
  path: string,
  method = "GET",
  requestOrigin = origin,
): Request =>
  new Request(`${origin}${path}`, {
    headers: {
      host: "mail.example.com",
      origin: requestOrigin,
      "x-veda-mail-session-scope": mailSessionScope({ id: connectionA }),
    },
    method,
  });

const route = (deliveryNoticeId: string) => ({
  params: Promise.resolve({ deliveryNoticeId }),
});

beforeEach(() => {
  deliveryNoticeStore.clearAll();
  mocks.assertRequestRateLimit.mockReset();
  mocks.assertSubjectRateLimit.mockReset();
  mocks.getCurrentConnection.mockReset();
  mocks.getCurrentConnection.mockResolvedValue({
    id: connectionA,
    providerId: "mock",
  });
});

describe("delivery notice routes", () => {
  it("returns the authenticated connection's FIFO notice snapshot", async () => {
    deliveryNoticeStore.append(
      connectionA,
      receipt(partialNoticeId, "partial"),
    );
    deliveryNoticeStore.append(
      connectionA,
      receipt(uncertainNoticeId, "uncertain"),
    );
    deliveryNoticeStore.append(
      connectionB,
      receipt("33333333-3333-4333-8333-333333333333", "uncertain"),
    );
    const routeRequest = request("/api/v1/mail/delivery-notices");

    const response = await GET(routeRequest);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({
      data: {
        notices: [
          {
            deliveryNoticeId: partialNoticeId,
            kind: "partial",
            rejectedRecipients: ["Rejected@Example.com"],
            submittedAt: "2026-07-30T12:00:00.000Z",
          },
          {
            deliveryNoticeId: uncertainNoticeId,
            kind: "uncertain",
            submittedAt: "2026-07-30T12:00:00.000Z",
          },
        ],
      },
    });
    expect(mocks.assertRequestRateLimit).toHaveBeenCalledWith(
      routeRequest,
      "mail-delivery-notice-read",
      10_000,
      600,
      60 * 1_000,
    );
    expect(mocks.assertSubjectRateLimit).toHaveBeenCalledWith(
      "mail-delivery-notice-read",
      connectionA,
      120,
      60 * 1_000,
    );
  });

  it("requires an authenticated connection for reads", async () => {
    mocks.getCurrentConnection.mockRejectedValueOnce(
      new ApiError(
        "Sign in with your mailbox account.",
        "MEMBER_SESSION_REQUIRED",
        401,
      ),
    );

    const response = await GET(request("/api/v1/mail/delivery-notices"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "MEMBER_SESSION_REQUIRED",
        message: "Sign in with your mailbox account.",
      },
    });
    expect(mocks.assertSubjectRateLimit).not.toHaveBeenCalled();
  });

  it("rejects a stale mailbox scope before notice access", async () => {
    deliveryNoticeStore.append(
      connectionA,
      receipt(partialNoticeId, "partial"),
    );
    const routeRequest = new Request(
      `${origin}/api/v1/mail/delivery-notices`,
      {
        headers: {
          host: "mail.example.com",
          origin,
          "x-veda-mail-session-scope": "stale-session-scope",
        },
      },
    );

    const response = await GET(routeRequest);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "MAIL_SESSION_CHANGED" },
    });
    expect(mocks.assertSubjectRateLimit).not.toHaveBeenCalled();
    expect(deliveryNoticeStore.list(connectionA)).toHaveLength(1);
  });

  it("dismisses idempotently without crossing connection scope", async () => {
    deliveryNoticeStore.append(
      connectionA,
      receipt(partialNoticeId, "partial"),
    );
    deliveryNoticeStore.append(
      connectionB,
      receipt(uncertainNoticeId, "uncertain"),
    );
    const routeRequest = request(
      `/api/v1/mail/delivery-notices/${partialNoticeId}`,
      "DELETE",
    );

    const removed = await DELETE(routeRequest, route(partialNoticeId));
    const repeated = await DELETE(routeRequest, route(partialNoticeId));
    const otherConnectionId = await DELETE(
      request(
        `/api/v1/mail/delivery-notices/${uncertainNoticeId}`,
        "DELETE",
      ),
      route(uncertainNoticeId),
    );

    expect(removed.status).toBe(204);
    expect(repeated.status).toBe(204);
    expect(otherConnectionId.status).toBe(204);
    expect(removed.headers.get("cache-control")).toBe("private, no-store");
    expect(deliveryNoticeStore.list(connectionA)).toEqual([]);
    expect(deliveryNoticeStore.list(connectionB)).toHaveLength(1);
    expect(mocks.assertSubjectRateLimit).toHaveBeenCalledWith(
      "mail-delivery-notice-dismiss",
      connectionA,
      120,
      60 * 1_000,
    );
  });

  it("rejects cross-origin dismissal before session or store access", async () => {
    deliveryNoticeStore.append(
      connectionA,
      receipt(partialNoticeId, "partial"),
    );

    const response = await DELETE(
      request(
        `/api/v1/mail/delivery-notices/${partialNoticeId}`,
        "DELETE",
        "https://evil.example.com",
      ),
      route(partialNoticeId),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_REQUEST_ORIGIN" },
    });
    expect(mocks.getCurrentConnection).not.toHaveBeenCalled();
    expect(deliveryNoticeStore.list(connectionA)).toHaveLength(1);
  });

  it("rejects a malformed dismissal identifier generically", async () => {
    const response = await DELETE(
      request("/api/v1/mail/delivery-notices/not-a-uuid", "DELETE"),
      route("not-a-uuid"),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
  });
});
