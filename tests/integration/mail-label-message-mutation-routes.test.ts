import { beforeEach, describe, expect, it, vi } from "vitest";

import { LabelPolicyError } from "@/domain/mail/label-policy";

const mocks = vi.hoisted(() => ({
  connection: { id: "connection-label-mutations" },
  getCurrentConnection: vi.fn(),
  getMailService: vi.fn(),
  mutateMessage: vi.fn(),
  requireActive: vi.fn(),
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
    email: "member@example.com", providerId: "stalwart",
  }),
}));
vi.mock("@/server/labels/label-catalog.store", () => ({
  labelCatalogStore: { requireActive: mocks.requireActive },
}));

import { PATCH as patchBulk } from "@/app/api/v1/mail/messages/bulk/route";
import { PATCH as patchMessage } from "@/app/api/v1/mail/messages/[messageId]/route";
import { mailSessionScope } from "@/server/connections/mail-session-scope";

const origin = "https://mail.example.com";
const labelId = "veda-label-aaaqeayeaudaocajbifqydiob4";
const request = (path: string, body: unknown) => new Request(`${origin}${path}`, {
  body: JSON.stringify(body),
  headers: {
    "content-type": "application/json",
    host: "mail.example.com",
    origin,
    "x-veda-mail-session-scope": mailSessionScope(mocks.connection),
  },
  method: "PATCH",
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentConnection.mockResolvedValue(mocks.connection);
  mocks.getMailService.mockResolvedValue({ mutateMessage: mocks.mutateMessage });
  mocks.mutateMessage.mockResolvedValue(undefined);
  mocks.requireActive.mockResolvedValue({ color: "#4f46e5", id: labelId, name: "Clients" });
});

describe("label message mutation routes", () => {
  it("resolves an active catalog label before a single provider mutation", async () => {
    const response = await patchMessage(request(
      "/api/v1/mail/messages/message-a",
      { labelId, type: "set-label", value: true },
    ), { params: Promise.resolve({ messageId: "message-a" }) });

    expect(response.status).toBe(200);
    expect(mocks.requireActive).toHaveBeenCalledWith(expect.any(Object), labelId);
    expect(mocks.mutateMessage).toHaveBeenCalledWith({
      labelId, messageId: "message-a", type: "set-label", value: true,
    });
  });

  it("resolves one active label before a bounded bulk operation", async () => {
    const response = await patchBulk(request(
      "/api/v1/mail/messages/bulk",
      { labelId, messageIds: ["message-a", "message-b"], type: "set-label", value: false },
    ));

    expect(response.status).toBe(200);
    expect(mocks.requireActive).toHaveBeenCalledOnce();
    expect(mocks.mutateMessage).toHaveBeenCalledTimes(2);
  });

  it("rejects missing catalog labels and raw provider fields before mutation", async () => {
    mocks.requireActive.mockRejectedValueOnce(new LabelPolicyError(
      "missing", "Label not found.",
    ));
    const missing = await patchMessage(request(
      "/api/v1/mail/messages/message-a",
      { labelId, type: "set-label", value: true },
    ), { params: Promise.resolve({ messageId: "message-a" }) });
    const raw = await patchBulk(request(
      "/api/v1/mail/messages/bulk",
      {
        labelId, messageIds: ["message-a"], providerKeyword: "raw-secret",
        type: "set-label", value: true,
      },
    ));

    expect(missing.status).toBe(404);
    expect(raw.status).toBe(400);
    expect(mocks.mutateMessage).not.toHaveBeenCalled();
  });
});
