import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAccount: vi.fn(), getCurrentConnection: vi.fn(), getDraft: vi.fn(),
}));
vi.mock("@/server/connections/connection-session", () => ({
  getCurrentConnection: mocks.getCurrentConnection,
}));
vi.mock("@/server/mail/mail-service", () => ({
  getMailService: vi.fn(async () => ({
    getAccount: mocks.getAccount, getDraft: mocks.getDraft,
  })),
}));

import { DELETE, PATCH } from "@/app/api/v1/mail/scheduled/[scheduledMessageId]/route";
import { GET, POST } from "@/app/api/v1/mail/scheduled/route";
import type { DraftDetail } from "@/domain/mail/draft";
import type { ProviderConnection } from "@/domain/provider/provider";
import { id } from "@/domain/shared/brand";
import { mailSessionScope } from "@/server/connections/mail-session-scope";

const originalDirectory = process.env["VEDA_MAIL_DATA_DIR"];
const originalKey = process.env["VEDA_MAIL_JOB_KEY"];
const origin = "https://mail.example.com";
let directory = "";
const connection: ProviderConnection = {
  config: { secret: "mailbox-secret", username: "member@example.com" },
  createdAt: "2026-08-02T00:00:00.000Z",
  displayName: "Mock mail",
  id: id.connection("11111111-1111-4111-8111-111111111111"),
  providerId: id.provider("mock"),
};
const composeId = id.draft("22222222-2222-4222-8222-222222222222");
const providerDraftId = id.providerDraft("provider-draft-1");
const content = {
  bcc: [], body: "Scheduled body", cc: [], subject: "Scheduled subject",
  to: [{ email: "recipient@example.com", name: null }],
};
const detail: DraftDetail = {
  attachments: [], composeId, content, hasAttachments: false,
  hasTruncatedContent: false, hasUncertainSubmission: false,
  id: providerDraftId, revision: "revision-1",
  updatedAt: "2026-08-02T01:00:00.000Z",
};
const later = (seconds = 60) => new Date(Date.now() + seconds * 1_000).toISOString();
const payload = () => ({
  purpose: "scheduled" as const,
  request: {
    attachmentIds: [], ...content, draftId: composeId,
    expectedDraftRevision: detail.revision, providerDraftId,
  },
  scheduledAt: later(),
});
const request = (
  method: "DELETE" | "GET" | "PATCH" | "POST",
  pathname: string,
  body?: unknown,
  requestOrigin = origin,
) => new Request(`${origin}${pathname}`, {
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  headers: {
    ...(body === undefined ? {} : { "content-type": "application/json" }),
    host: "mail.example.com", origin: requestOrigin,
    "x-veda-mail-session-scope": mailSessionScope(connection),
  },
  method,
});
const context = (scheduledMessageId: string) => ({
  params: Promise.resolve({ scheduledMessageId }),
});

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "veda-scheduled-route-"));
  process.env["VEDA_MAIL_DATA_DIR"] = directory;
  process.env["VEDA_MAIL_JOB_KEY"] = Buffer.alloc(32, 4).toString("base64");
  mocks.getCurrentConnection.mockReset();
  mocks.getCurrentConnection.mockResolvedValue(connection);
  mocks.getAccount.mockReset();
  mocks.getAccount.mockResolvedValue({
    email: "member@example.com", id: "account", name: "Member", providerId: "mock",
  });
  mocks.getDraft.mockReset();
  mocks.getDraft.mockResolvedValue(detail);
});

afterEach(async () => {
  if (originalDirectory === undefined) delete process.env["VEDA_MAIL_DATA_DIR"];
  else process.env["VEDA_MAIL_DATA_DIR"] = originalDirectory;
  if (originalKey === undefined) delete process.env["VEDA_MAIL_JOB_KEY"];
  else process.env["VEDA_MAIL_JOB_KEY"] = originalKey;
  await rm(directory, { force: true, recursive: true });
});

describe("scheduled-send routes", () => {
  it("creates, lists, reschedules, and cancels an owner-scoped job", async () => {
    const created = await POST(request("POST", "/api/v1/mail/scheduled", payload()));
    expect(created.status).toBe(201);
    const createdBody = await created.json() as {
      data: {
        createdMessage: { id: string };
        messages: readonly { id: string; purpose: string; status: string }[];
      };
    };
    expect(createdBody.data.messages[0]?.status).toBe("pending");
    expect(createdBody.data.messages[0]).toMatchObject({ purpose: "scheduled" });
    expect(mocks.getDraft).toHaveBeenCalledWith(providerDraftId);
    const messageId = createdBody.data.messages[0]!.id;
    expect(createdBody.data.createdMessage.id).toBe(messageId);

    const listed = await GET(request("GET", "/api/v1/mail/scheduled"));
    expect((await listed.json() as typeof createdBody).data.messages).toHaveLength(1);
    const patched = await PATCH(
      request("PATCH", `/api/v1/mail/scheduled/${messageId}`, {
        scheduledAt: later(120),
      }),
      context(messageId),
    );
    expect(patched.status).toBe(200);
    const deleted = await DELETE(
      request("DELETE", `/api/v1/mail/scheduled/${messageId}`),
      context(messageId),
    );
    expect(deleted.status).toBe(204);
  });

  it("rejects unsaved attachments, stale drafts, and cross-origin writes", async () => {
    const base = payload();
    const localAttachment = {
      ...base,
      request: {
        ...base.request,
        attachmentIds: ["local-upload-that-is-not-durable"],
      },
    };
    expect((await POST(request("POST", "/api/v1/mail/scheduled", localAttachment))).status)
      .toBe(400);
    mocks.getDraft.mockResolvedValueOnce({ ...detail, revision: "newer" });
    expect((await POST(request("POST", "/api/v1/mail/scheduled", payload()))).status)
      .toBe(409);
    const attacked = await POST(request(
      "POST", "/api/v1/mail/scheduled", payload(), "https://attacker.example",
    ));
    expect(attacked.status).toBe(403);
  });

  it("requires exact browser scope and an external queue key", async () => {
    const missingScope = request("GET", "/api/v1/mail/scheduled");
    missingScope.headers.delete("x-veda-mail-session-scope");
    expect((await GET(missingScope)).status).toBe(409);
    delete process.env["VEDA_MAIL_JOB_KEY"];
    const unavailable = await GET(request("GET", "/api/v1/mail/scheduled"));
    expect(unavailable.status).toBe(503);
    await expect(unavailable.json()).resolves.toMatchObject({
      error: { code: "SCHEDULED_SEND_UNAVAILABLE" },
    });
  });
});
