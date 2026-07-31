import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentConnection: vi.fn(),
  sendMessage: vi.fn(),
}));

vi.mock("@/server/connections/connection-session", () => ({
  getCurrentConnection: mocks.getCurrentConnection,
}));
vi.mock("@/server/mail/mail-service", () => ({
  getMailService: vi.fn(async () => ({ sendMessage: mocks.sendMessage })),
}));

import { POST } from "@/app/api/v1/mail/send/route";
import {
  DraftConflictError,
  DraftContentTruncatedError,
  DraftNotFoundError,
} from "@/domain/mail/draft-errors";
import type { ProviderConnection } from "@/domain/provider/provider";
import { id } from "@/domain/shared/brand";
import { connectionStore } from "@/server/connections/connection-store";
import { mailSessionScope } from "@/server/connections/mail-session-scope";

const origin = "https://mail.example.com";
let connection: ProviderConnection;

const payload = (overrides: Record<string, unknown> = {}) => ({
  body: "Saved draft body",
  draftId: "11111111-1111-4111-8111-111111111111",
  expectedDraftRevision: "state-2",
  providerDraftId: "provider-draft-42",
  subject: "Saved draft subject",
  to: [{ email: "recipient@example.com", name: null }],
  ...overrides,
});

const request = (body: Record<string, unknown>) =>
  new Request(`${origin}/api/v1/mail/send`, {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      host: "mail.example.com",
      origin,
      "x-veda-mail-session-scope": mailSessionScope(connection),
    },
    method: "POST",
  });

beforeEach(() => {
  connectionStore.clearAll();
  connection = connectionStore.create(
    {
      config: {},
      displayName: "Saved draft send",
      providerId: id.provider("stalwart-jmap"),
    },
    "saved-draft-send-revision",
  );
  mocks.getCurrentConnection.mockReset();
  mocks.getCurrentConnection.mockResolvedValue(connection);
  mocks.sendMessage.mockReset();
  mocks.sendMessage.mockResolvedValue({
    deliveryStatus: "accepted",
    id: id.message("sent-message"),
    rejectedRecipients: [],
    submittedAt: "2026-07-31T02:00:00.000Z",
  });
});

describe("saved provider draft send handoff", () => {
  it("passes the opaque ID, compose UUID, and revision as one typed handoff", async () => {
    const response = await POST(request(payload()));

    expect(response.status).toBe(201);
    expect(mocks.sendMessage).toHaveBeenCalledWith({
      attachments: [],
      bcc: [],
      body: "Saved draft body",
      cc: [],
      providerDraft: {
        composeId: "11111111-1111-4111-8111-111111111111",
        expectedRevision: "state-2",
        id: "provider-draft-42",
      },
      subject: "Saved draft subject",
      to: [{ email: "recipient@example.com", name: null }],
    });
  });

  it.each([
    [new DraftConflictError(), 409, "MAIL_DRAFT_CONFLICT"],
    [
      new DraftContentTruncatedError(),
      409,
      "MAIL_DRAFT_CONTENT_TRUNCATED",
    ],
    [new DraftNotFoundError(), 404, "MAIL_DRAFT_NOT_FOUND"],
  ])("maps stale or forged saved drafts without leaking IDs", async (error, status, code) => {
    mocks.sendMessage.mockRejectedValueOnce(error);
    const response = await POST(request(payload()));
    const body = await response.json();

    expect(response.status).toBe(status);
    expect(body).toMatchObject({ error: { code } });
    expect(JSON.stringify(body)).not.toContain("provider-draft-42");
  });

  it("rejects an unpaired handoff before provider access", async () => {
    const response = await POST(
      request(payload({ expectedDraftRevision: undefined })),
    );

    expect(response.status).toBe(400);
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });
});
