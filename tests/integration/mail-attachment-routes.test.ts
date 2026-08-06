import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => {
  const getMaxAttachmentBytes = vi.fn(async () => 18 * 1024 * 1024);
  return {
    connection: vi.fn(),
    getMaxAttachmentBytes,
    mailService: vi.fn(async () => ({ getMaxAttachmentBytes })),
    policy: vi.fn(),
  };
});

vi.mock("@/server/connections/connection-session", () => ({
  getCurrentConnection: mocks.connection,
}));
vi.mock("@/server/mail/mail-service", () => ({
  getMailService: mocks.mailService,
}));
vi.mock("@/server/organization/mail-content-policy.service", async (original) => ({
  ...(await original()),
  getMailContentPolicy: mocks.policy,
}));

import { POST as reserve } from "@/app/api/v1/mail/attachments/route";
import {
  DELETE as remove,
  PUT as upload,
} from "@/app/api/v1/mail/attachments/[attachmentId]/route";
import type { ProviderConnection } from "@/domain/provider/provider";
import { id } from "@/domain/shared/brand";
import { connectionStore } from "@/server/connections/connection-store";
import { mailSessionScope } from "@/server/connections/mail-session-scope";
import { DEFAULT_MAIL_CONTENT_POLICY } from "@/domain/installation/mail-content-policy";
const origin = "https://mail.example.com";
let activeConnection: ProviderConnection;
const draftId = () => crypto.randomUUID();
const route = (attachmentId: string) => ({
  params: Promise.resolve({ attachmentId }),
});
const mutationHeaders = {
  host: "mail.example.com",
  origin,
};

const reserveAttachment = async (
  draft: string,
  fileName = "report.txt",
  content = "attachment bytes",
) => {
  const size = new TextEncoder().encode(content).byteLength;
  const response = await reserve(
    new Request(`${origin}/api/v1/mail/attachments`, {
      body: JSON.stringify({
        declaredMimeType: "text/plain",
        draftId: draft,
        fileName,
        size,
      }),
      headers: {
        ...mutationHeaders,
        "content-type": "application/json",
        "x-veda-mail-session-scope": mailSessionScope(activeConnection),
      },
      method: "POST",
    }),
  );
  expect(response.status).toBe(201);
  const payload = (await response.json()) as {
    data: { id: string; uploadUrl: string };
  };
  return { ...payload.data, content, size };
};

const uploadAttachment = (
  attachmentId: string,
  draft: string,
  content: string,
  size: number,
) =>
  upload(
    new Request(`${origin}/api/v1/mail/attachments/${attachmentId}`, {
      body: content,
      headers: {
        ...mutationHeaders,
        "content-length": String(size),
        "content-type": "text/plain",
        "x-veda-draft-id": draft,
        "x-veda-mail-session-scope": mailSessionScope(activeConnection),
      },
      method: "PUT",
    }),
    route(attachmentId),
  );

beforeEach(() => {
  connectionStore.clearAll();
  activeConnection = connectionStore.create(
    {
      config: {},
      displayName: "Attachment routes",
      providerId: id.provider("mock"),
    },
    "attachment-routes-revision",
  );
  mocks.connection.mockReset();
  mocks.connection.mockResolvedValue(activeConnection);
  mocks.getMaxAttachmentBytes.mockReset();
  mocks.getMaxAttachmentBytes.mockResolvedValue(18 * 1024 * 1024);
  mocks.mailService.mockClear();
  mocks.policy.mockReset();
  mocks.policy.mockResolvedValue(DEFAULT_MAIL_CONTENT_POLICY);
});

describe("secure attachment routes", () => {
  it("sanitizes, scans, and removes an upload without exposing storage paths", async () => {
    const draft = draftId();
    const reservation = await reserveAttachment(
      draft,
      "../report\r\nfinal.txt",
    );
    expect(reservation.id).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(reservation.uploadUrl).not.toContain("..");

    const uploaded = await uploadAttachment(
      reservation.id,
      draft,
      reservation.content,
      reservation.size,
    );
    expect(uploaded.status).toBe(200);
    const payload = (await uploaded.json()) as {
      data: {
        expiresAt: string;
        id: string;
        mimeType: string;
        name: string;
        size: number;
      };
    };
    expect(payload.data).toMatchObject({
      id: reservation.id,
      mimeType: "text/plain",
      size: reservation.size,
    });
    expect(Date.parse(payload.data.expiresAt)).toBeGreaterThan(Date.now());
    expect(payload.data.name).not.toMatch(/[\\/\r\n]/);
    expect(JSON.stringify(payload)).not.toMatch(/(?:\/tmp|encryptedFile)/);

    const deleted = await remove(
      new Request(
        `${origin}${reservation.uploadUrl}?draftId=${encodeURIComponent(draft)}`,
        {
          headers: {
            ...mutationHeaders,
            "x-veda-mail-session-scope": mailSessionScope(activeConnection),
          },
          method: "DELETE",
        },
      ),
      route(reservation.id),
    );
    expect(deleted.status).toBe(204);
  });

  it("does not let a different draft remove a reserved attachment", async () => {
    const draft = draftId();
    const reservation = await reserveAttachment(draft);
    const hidden = await remove(
      new Request(
        `${origin}${reservation.uploadUrl}?draftId=${encodeURIComponent(
          draftId(),
        )}`,
        {
          headers: {
            ...mutationHeaders,
            "x-veda-mail-session-scope": mailSessionScope(activeConnection),
          },
          method: "DELETE",
        },
      ),
      route(reservation.id),
    );
    expect(hidden.status).toBe(204);

    const uploaded = await uploadAttachment(
      reservation.id,
      draft,
      reservation.content,
      reservation.size,
    );
    expect(uploaded.status).toBe(200);
  });

  it("rejects a body whose exact length differs from its reservation", async () => {
    const draft = draftId();
    const reservation = await reserveAttachment(draft);
    const response = await uploadAttachment(
      reservation.id,
      draft,
      `${reservation.content}x`,
      reservation.size + 1,
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "ATTACHMENT_LENGTH_MISMATCH" },
    });
  });

  it("rejects a stale mailbox scope before attachment reservation work", async () => {
    const response = await reserve(
      new Request(`${origin}/api/v1/mail/attachments`, {
        body: JSON.stringify({
          declaredMimeType: "text/plain",
          draftId: draftId(),
          fileName: "stale.txt",
          size: 5,
        }),
        headers: {
          ...mutationHeaders,
          "content-type": "application/json",
          "x-veda-mail-session-scope": "stale-session-scope",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "MAIL_SESSION_CHANGED" },
    });
    expect(mocks.mailService).not.toHaveBeenCalled();
  });

});
