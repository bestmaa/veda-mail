import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertRequestRateLimit: vi.fn(),
  assertSubjectRateLimit: vi.fn(),
  get: vi.fn(),
  getAccount: vi.fn(),
  getCurrentConnection: vi.fn(),
  put: vi.fn(),
}));

vi.mock("@/server/connections/connection-session", () => ({
  getCurrentConnection: mocks.getCurrentConnection,
}));
vi.mock("@/server/mail/gateway-cache", () => ({
  resolveGateway: async () => ({ getAccount: mocks.getAccount }),
}));
vi.mock("@/server/security/rate-limit", () => ({
  assertRequestRateLimit: mocks.assertRequestRateLimit,
  assertSubjectRateLimit: mocks.assertSubjectRateLimit,
}));
vi.mock("@/server/signatures/email-signature.store", () => ({
  emailSignatureStore: { get: mocks.get, put: mocks.put },
}));

import {
  MAX_EMAIL_SIGNATURE_REQUEST_BYTES,
  type EmailSignatureBook,
} from "@/domain/member/email-signature";
import { id } from "@/domain/shared/brand";
import {
  GET,
  PUT,
} from "@/app/api/v1/member/signatures/route";
import { ApiError } from "@/transport/http/api-error";

const origin = "https://mail.example.com";
const connection = {
  config: {},
  createdAt: "2026-07-31T00:00:00.000Z",
  displayName: "Mail",
  id: id.connection("signature-route-connection"),
  providerId: id.provider("mock"),
};
const emptyBook: EmailSignatureBook = {
  createdAt: null,
  defaults: { newMessageId: null, replyForwardId: null },
  revision: null,
  signatures: [],
  updatedAt: null,
  version: 1,
};

const request = (
  method: "GET" | "PUT",
  body?: unknown,
  requestOrigin = origin,
) =>
  new Request(`${origin}/api/v1/member/signatures`, {
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      host: "mail.example.com",
      origin: requestOrigin,
    },
    method,
  });

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.getCurrentConnection.mockResolvedValue(connection);
  mocks.getAccount.mockResolvedValue({
    email: "Member@Example.com",
    id: id.account("member"),
    name: "Member",
    providerId: id.provider("mock"),
  });
  mocks.get.mockResolvedValue(emptyBook);
  mocks.put.mockResolvedValue({
    ...emptyBook,
    createdAt: "2026-07-31T01:00:00.000Z",
    revision: "11111111-1111-4111-8111-111111111111",
    updatedAt: "2026-07-31T01:00:00.000Z",
  });
});

describe("member email signature routes", () => {
  it("loads only the gateway-derived provider identity with private caching", async () => {
    const routeRequest = request("GET");
    const response = await GET(routeRequest);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.get).toHaveBeenCalledWith({
      email: "Member@Example.com",
      providerId: "mock",
    });
    expect(mocks.assertRequestRateLimit).toHaveBeenCalledWith(
      routeRequest,
      "member-signature-read",
      10_000,
      600,
      60 * 1000,
    );
    expect(mocks.assertSubjectRateLimit).toHaveBeenCalledWith(
      "member-signature-read",
      connection.id,
      120,
      60 * 1000,
    );
  });

  it("accepts the authoritative strict create operation", async () => {
    const operation = {
      content: { htmlBody: "<p>Regards</p>", mode: "rich" },
      expectedRevision: null,
      name: "Work",
      operation: "create",
    };
    const routeRequest = request("PUT", operation);
    const response = await PUT(routeRequest);

    expect(response.status).toBe(201);
    expect(mocks.put).toHaveBeenCalledWith(
      { email: "Member@Example.com", providerId: "mock" },
      operation,
    );
    expect(mocks.assertSubjectRateLimit).toHaveBeenCalledWith(
      "member-signature-write",
      connection.id,
      20,
      15 * 60 * 1000,
    );
  });

  it("rejects cross-origin writes before authentication or rate charging", async () => {
    const response = await PUT(
      request(
        "PUT",
        {
          content: { body: "Regards", mode: "plain" },
          expectedRevision: null,
          name: "Work",
          operation: "create",
        },
        "https://attacker.example",
      ),
    );

    expect(response.status).toBe(403);
    expect(mocks.getCurrentConnection).not.toHaveBeenCalled();
    expect(mocks.assertRequestRateLimit).not.toHaveBeenCalled();
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it.each([
    {
      content: { body: "Regards", mode: "plain" },
      expectedRevision: null,
      name: "Work",
      operation: "create",
      ownerEmail: "victim@example.com",
    },
    {
      expectedRevision: null,
      operation: "delete",
      signatureId: "not-a-uuid",
    },
  ])("rejects malformed or mass-assignment input", async (body) => {
    const response = await PUT(request("PUT", body));

    expect(response.status).toBe(400);
    expect(mocks.getAccount).not.toHaveBeenCalled();
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it("stops an oversized request before identity or store access", async () => {
    const response = await PUT(
      request("PUT", {
        content: {
          body: "x".repeat(MAX_EMAIL_SIGNATURE_REQUEST_BYTES),
          mode: "plain",
        },
        expectedRevision: null,
        name: "Work",
        operation: "create",
      }),
    );

    expect(response.status).toBe(413);
    expect(mocks.getAccount).not.toHaveBeenCalled();
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it("preserves a deliberate authentication failure without gateway access", async () => {
    mocks.getCurrentConnection.mockRejectedValueOnce(
      new ApiError(
        "Sign in with your mailbox account.",
        "MEMBER_SESSION_REQUIRED",
        401,
      ),
    );
    const response = await GET(request("GET"));

    expect(response.status).toBe(401);
    expect(mocks.getAccount).not.toHaveBeenCalled();
    expect(mocks.get).not.toHaveBeenCalled();
  });
});
