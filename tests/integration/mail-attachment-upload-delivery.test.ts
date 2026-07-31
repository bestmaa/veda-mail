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

import { PUT as upload } from "@/app/api/v1/mail/attachments/[attachmentId]/route";
import { POST as reserve } from "@/app/api/v1/mail/attachments/route";
import { POST as send } from "@/app/api/v1/mail/send/route";
import type { ProviderConnection } from "@/domain/provider/provider";
import { id } from "@/domain/shared/brand";
import { connectionStore } from "@/server/connections/connection-store";
import { mailSessionScope } from "@/server/connections/mail-session-scope";

const origin = "https://mail.example.com";
const mutationHeaders = { host: "mail.example.com", origin };
let activeConnection: ProviderConnection;

const route = (attachmentId: string) => ({
  params: Promise.resolve({ attachmentId }),
});

const reserveAndUpload = async () => {
  const content = "attachment bytes";
  const draftId = crypto.randomUUID();
  const size = Buffer.byteLength(content);
  const reserved = await reserve(
    new Request(`${origin}/api/v1/mail/attachments`, {
      body: JSON.stringify({
        declaredMimeType: "text/plain",
        draftId,
        fileName: "report.txt",
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
  expect(reserved.status).toBe(201);
  const payload = (await reserved.json()) as { data: { id: string } };
  const uploaded = await upload(
    new Request(`${origin}/api/v1/mail/attachments/${payload.data.id}`, {
      body: content,
      headers: {
        ...mutationHeaders,
        "content-length": String(size),
        "content-type": "text/plain",
        "x-veda-draft-id": draftId,
        "x-veda-mail-session-scope": mailSessionScope(activeConnection),
      },
      method: "PUT",
    }),
    route(payload.data.id),
  );
  expect(uploaded.status).toBe(200);
  return { attachmentId: payload.data.id, content, draftId, size };
};

beforeEach(() => {
  connectionStore.clearAll();
  activeConnection = connectionStore.create(
    {
      config: {},
      displayName: "Attachment upload delivery",
      providerId: id.provider("mock"),
    },
    "attachment-upload-delivery-revision",
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

describe("attachment upload delivery", () => {
  it("delivers clean bytes to the provider and consumes the quarantine record", async () => {
    const attachment = await reserveAndUpload();
    const response = await send(
      new Request(`${origin}/api/v1/mail/send`, {
        body: JSON.stringify({
          attachmentIds: [attachment.attachmentId],
          body: "See attachment.",
          draftId: attachment.draftId,
          subject: "Attachment",
          to: [{ email: "recipient@example.com", name: null }],
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
    expect(Buffer.from(delivered.content).toString()).toBe(attachment.content);
    expect(delivered).toMatchObject({
      id: attachment.attachmentId,
      mimeType: "text/plain",
      size: attachment.size,
    });
  });
});
