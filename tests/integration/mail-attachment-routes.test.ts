import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const getMaxAttachmentBytes = vi.fn(async () => 18 * 1024 * 1024);
  const sendMessage = vi.fn(async (input: unknown) => {
    void input;
    return {
      id: "sent-with-attachment",
      submittedAt: "2026-07-29T00:00:00.000Z",
    };
  });
  return {
    connection: vi.fn(),
    getMaxAttachmentBytes,
    mailService: vi.fn(async () => ({ getMaxAttachmentBytes, sendMessage })),
    sendMessage,
  };
});

vi.mock("@/server/connections/connection-session", () => ({
  getCurrentConnection: mocks.connection,
}));
vi.mock("@/server/mail/mail-service", () => ({
  getMailService: mocks.mailService,
}));

import { POST as reserve } from "@/app/api/v1/mail/attachments/route";
import {
  DELETE as remove,
  PUT as upload,
} from "@/app/api/v1/mail/attachments/[attachmentId]/route";
import { POST as send } from "@/app/api/v1/mail/send/route";
import type { ProviderConnection } from "@/domain/provider/provider";
import { id } from "@/domain/shared/brand";
import { connectionStore } from "@/server/connections/connection-store";
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
  mocks.sendMessage.mockReset();
  mocks.sendMessage.mockResolvedValue({
    id: "sent-with-attachment",
    submittedAt: "2026-07-29T00:00:00.000Z",
  });
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
        { headers: mutationHeaders, method: "DELETE" },
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
        { headers: mutationHeaders, method: "DELETE" },
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

  it("delivers clean bytes to the provider and consumes the quarantine record", async () => {
    const draft = draftId();
    const reservation = await reserveAttachment(draft);
    expect(
      (
        await uploadAttachment(
          reservation.id,
          draft,
          reservation.content,
          reservation.size,
        )
      ).status,
    ).toBe(200);

    const response = await send(
      new Request(`${origin}/api/v1/mail/send`, {
        body: JSON.stringify({
          attachmentIds: [reservation.id],
          body: "See attachment.",
          draftId: draft,
          subject: "Attachment",
          to: [{ email: "recipient@example.com", name: null }],
        }),
        headers: {
          ...mutationHeaders,
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );
    expect(response.status).toBe(201);
    const input = mocks.sendMessage.mock.calls[0]?.[0] as {
      attachments: readonly {
        content: Uint8Array;
        id: string;
        mimeType: string;
        size: number;
      }[];
    };
    expect(input.attachments).toHaveLength(1);
    const delivered = input.attachments[0];
    if (!delivered) throw new Error("Attachment was not delivered.");
    expect(Buffer.from(delivered.content).toString()).toBe(reservation.content);
    expect(delivered).toMatchObject({
      id: reservation.id,
      mimeType: "text/plain",
      size: reservation.size,
    });
  });
});
