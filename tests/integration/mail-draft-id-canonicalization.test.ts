import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProviderConnection } from "@/domain/provider/provider";
import { id } from "@/domain/shared/brand";

const mocks = vi.hoisted(() => ({
  getCurrentConnection: vi.fn(),
  getMaxAttachmentBytes: vi.fn(async () => 18 * 1024 * 1024),
  sendMessage: vi.fn(async () => ({
    deliveryStatus: "accepted",
    id: "canonical-draft-message",
    rejectedRecipients: [] as string[],
    submittedAt: "2026-07-30T12:00:00.000Z",
  })),
}));

vi.mock("@/server/connections/connection-session", () => ({
  getCurrentConnection: mocks.getCurrentConnection,
}));

vi.mock("@/server/mail/mail-service", () => ({
  getMailService: async () => ({
    getMaxAttachmentBytes: mocks.getMaxAttachmentBytes,
    sendMessage: mocks.sendMessage,
  }),
}));

import { PUT as upload } from "@/app/api/v1/mail/attachments/[attachmentId]/route";
import { POST as reserve } from "@/app/api/v1/mail/attachments/route";
import { POST as send } from "@/app/api/v1/mail/send/route";
import { connectionStore } from "@/server/connections/connection-store";
import { attachmentService } from "@/server/mail/attachment-service";

const origin = "https://mail.example.com";
const headers = { host: "mail.example.com", origin };
const uppercaseDraft = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
const lowercaseDraft = uppercaseDraft.toLowerCase();
let activeConnection: ProviderConnection;

const attachmentRoute = (attachmentId: string) => ({
  params: Promise.resolve({ attachmentId }),
});

const sendDraft = (draftId: string, attachmentId: string) =>
  send(
    new Request(`${origin}/api/v1/mail/send`, {
      body: JSON.stringify({
        attachmentIds: [attachmentId],
        body: "Canonical draft attachment",
        draftId,
        subject: "Canonical UUID",
        to: [{ email: "recipient@example.com", name: null }],
      }),
      headers: { ...headers, "content-type": "application/json" },
      method: "POST",
    }),
  );

beforeEach(() => {
  connectionStore.clearAll();
  activeConnection = connectionStore.create(
    {
      config: {},
      displayName: "Canonical draft",
      providerId: id.provider("mock"),
    },
    "canonical-draft-revision",
  );
  mocks.getCurrentConnection.mockReset();
  mocks.getCurrentConnection.mockResolvedValue(activeConnection);
  mocks.getMaxAttachmentBytes.mockClear();
  mocks.sendMessage.mockClear();
});

describe("draft UUID route canonicalization", () => {
  it("shares attachment scope and replay state across UUID casing", async () => {
    const content = "canonical draft bytes";
    const reserved = await reserve(
      new Request(`${origin}/api/v1/mail/attachments`, {
        body: JSON.stringify({
          declaredMimeType: "text/plain",
          draftId: uppercaseDraft,
          fileName: "canonical.txt",
          size: Buffer.byteLength(content),
        }),
        headers: { ...headers, "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(reserved.status).toBe(201);
    const reservation = (await reserved.json()) as { data: { id: string } };
    const uploaded = await upload(
      new Request(
        `${origin}/api/v1/mail/attachments/${reservation.data.id}`,
        {
          body: content,
          headers: {
            ...headers,
            "content-length": String(Buffer.byteLength(content)),
            "content-type": "text/plain",
            "x-veda-draft-id": lowercaseDraft,
          },
          method: "PUT",
        },
      ),
      attachmentRoute(reservation.data.id),
    );
    expect(uploaded.status).toBe(200);
    const claim = vi.spyOn(attachmentService(), "claim");

    const first = await sendDraft(uppercaseDraft, reservation.data.id);
    const replay = await sendDraft(lowercaseDraft, reservation.data.id);

    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(await replay.json()).toEqual(await first.json());
    expect(claim).toHaveBeenCalledOnce();
    expect(mocks.sendMessage).toHaveBeenCalledOnce();
    claim.mockRestore();
  });
});
