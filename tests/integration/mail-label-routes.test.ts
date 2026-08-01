import { beforeEach, describe, expect, it, vi } from "vitest";

import { LabelPolicyError } from "@/domain/mail/label-policy";
import { id } from "@/domain/shared/brand";

const mocks = vi.hoisted(() => ({
  connection: { id: "connection-labels" },
  create: vi.fn(),
  getCurrentConnection: vi.fn(),
  getMailService: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/server/connections/connection-session", () => ({
  getCurrentConnection: mocks.getCurrentConnection,
}));
vi.mock("@/server/mail/mail-service", () => ({
  getMailService: mocks.getMailService,
}));
vi.mock("@/server/security/rate-limit", () => ({
  assertRequestRateLimit: vi.fn(),
  assertSubjectRateLimit: vi.fn(),
}));
vi.mock("@/server/mailboxes/mailbox-http", () => ({
  mailboxOwner: vi.fn().mockResolvedValue({
    email: "member@example.com",
    providerId: "stalwart",
  }),
}));
vi.mock("@/server/labels/label-catalog.store", () => ({
  labelCatalogStore: { create: mocks.create, update: mocks.update },
}));

import { PATCH, POST } from "@/app/api/v1/mail/labels/route";
import { mailSessionScope } from "@/server/connections/mail-session-scope";

const origin = "https://mail.example.com";
const request = (method: "PATCH" | "POST", body: unknown, scope = mailSessionScope(mocks.connection)) =>
  new Request(`${origin}/api/v1/mail/labels`, {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      host: "mail.example.com",
      origin,
      "x-veda-mail-session-scope": scope,
    },
    method,
  });
const labelId = id.label("veda-label-aaaqeayeaudaocajbifqydiob4");
const labels = [{ color: "#4f46e5" as const, id: labelId, name: "Clients" }];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentConnection.mockResolvedValue(mocks.connection);
  mocks.getMailService.mockResolvedValue({});
  mocks.create.mockResolvedValue(labels);
  mocks.update.mockResolvedValue(labels);
});

describe("mail label routes", () => {
  it("creates an account-scoped label through the encrypted catalog", async () => {
    const response = await POST(request("POST", {
      color: "#4f46e5",
      name: "Clients",
    }));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ data: { labels } });
    expect(mocks.create).toHaveBeenCalledWith(
      { email: "member@example.com", providerId: "stalwart" },
      { color: "#4f46e5", name: "Clients" },
    );
  });

  it("renames and recolors only a catalog label identifier", async () => {
    const response = await PATCH(request("PATCH", {
      color: "#10b981",
      labelId,
      name: "Customers",
    }));

    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(
      expect.any(Object), labelId, { color: "#10b981", name: "Customers" },
    );
  });

  it("rejects stale scope, raw provider tokens, and multiline names", async () => {
    const stale = await POST(request("POST", {
      color: "#4f46e5", name: "Clients",
    }, "stale"));
    const rawToken = await POST(request("POST", {
      color: "#4f46e5", name: "Clients", providerKeyword: "secret-token",
    }));
    const multiline = await POST(request("POST", {
      color: "#4f46e5", name: "Client\nFiles",
    }));

    expect(stale.status).toBe(409);
    expect(rawToken.status).toBe(400);
    expect(multiline.status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("maps catalog policy failures to stable HTTP errors", async () => {
    mocks.create.mockRejectedValue(new LabelPolicyError(
      "conflict",
      "A label with this name already exists.",
    ));

    const response = await POST(request("POST", {
      color: "#4f46e5", name: "Clients",
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: {
      code: "LABEL_CONFLICT",
      message: "A label with this name already exists.",
    } });
  });
});
