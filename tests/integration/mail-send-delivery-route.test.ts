import { beforeEach, describe, expect, it, vi } from "vitest";

import { MessageDeliveryRejectedError } from "@/domain/mail/mail-errors";
import type { ProviderConnection } from "@/domain/provider/provider";
import { id } from "@/domain/shared/brand";

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
import { connectionStore } from "@/server/connections/connection-store";
import { deliveryNoticeStore } from "@/server/mail/delivery-notice-store";

let activeConnection: ProviderConnection;

const sendRequest = (body: Record<string, unknown>) =>
  POST(
    new Request("https://mail.example.com/api/v1/mail/send", {
      body: JSON.stringify({ draftId: crypto.randomUUID(), ...body }),
      headers: {
        "content-type": "application/json",
        host: "mail.example.com",
        origin: "https://mail.example.com",
      },
      method: "POST",
    }),
  );

beforeEach(() => {
  connectionStore.clearAll();
  activeConnection = connectionStore.create(
    {
      config: {},
      displayName: "Delivery route",
      providerId: id.provider("mock"),
    },
    "delivery-route-revision",
  );
  mocks.getCurrentConnection.mockReset();
  mocks.getCurrentConnection.mockResolvedValue(activeConnection);
  mocks.sendMessage.mockReset();
});

describe("mail send delivery receipt boundary", () => {
  it("maps an all-recipient rejection without exposing recipient data", async () => {
    mocks.sendMessage.mockRejectedValueOnce(new MessageDeliveryRejectedError());
    const privateRecipient = "private-recipient@example.com";
    const response = await sendRequest({
      bcc: [{ email: privateRecipient, name: null }],
      body: "Private recipient must never appear in the failure.",
      subject: "Delivery rejection",
      to: [],
    });

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body).toEqual({
      error: {
        code: "MAIL_RECIPIENTS_REJECTED",
        message:
          "The mail provider rejected every recipient. Check the addresses and try again.",
      },
    });
    expect(JSON.stringify(body)).not.toContain(privateRecipient);
    expect(mocks.sendMessage).toHaveBeenCalledOnce();
  });

  it("canonicalizes a valid partial provider receipt", async () => {
    mocks.sendMessage.mockResolvedValueOnce({
      deliveryStatus: "partial",
      id: " provider-message ",
      rejectedRecipients: [
        "hidden@example.com",
        "COPY@example.com",
        "copy@example.com",
      ],
      submittedAt: "2026-07-30T11:59:00.000Z",
    });

    const response = await sendRequest({
      bcc: [{ email: "Hidden@Example.com", name: null }],
      body: "Canonical partial receipt.",
      cc: [{ email: "Copy@Example.com", name: null }],
      subject: "Partial",
      to: [{ email: "Primary@Example.com", name: null }],
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual({
      data: expect.objectContaining({
        deliveryNoticeId: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
        ),
        deliveryStatus: "partial",
        id: "provider-message",
        rejectedRecipients: ["Copy@Example.com", "Hidden@Example.com"],
        submittedAt: "2026-07-30T11:59:00.000Z",
      }),
    });
    expect(deliveryNoticeStore.list(activeConnection.id)).toEqual([
      {
        deliveryNoticeId: body.data.deliveryNoticeId,
        kind: "partial",
        rejectedRecipients: ["Copy@Example.com", "Hidden@Example.com"],
        submittedAt: "2026-07-30T11:59:00.000Z",
      },
    ]);
  });

  it("returns terminal uncertain success without leaking malformed values", async () => {
    const unsubmitted = "unsubmitted-secret@example.com";
    mocks.sendMessage.mockResolvedValueOnce({
      deliveryStatus: "partial",
      id: unsubmitted,
      rejectedRecipients: [unsubmitted],
      submittedAt: "not-a-date",
    });

    const response = await sendRequest({
      bcc: [{ email: "private-recipient@example.com", name: null }],
      body: "Ambiguous provider response.",
      subject: "Uncertain",
      to: [],
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toMatchObject({
      data: {
        deliveryNoticeId: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
        ),
        deliveryStatus: "uncertain",
        id: expect.stringMatching(
          /^receipt-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
        ),
        rejectedRecipients: [],
        submittedAt: expect.stringMatching(
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u,
        ),
      },
    });
    expect(JSON.stringify(body)).not.toContain(unsubmitted);
    expect(deliveryNoticeStore.list(activeConnection.id)).toEqual([
      {
        deliveryNoticeId: body.data.deliveryNoticeId,
        kind: "uncertain",
        submittedAt: body.data.submittedAt,
      },
    ]);
  });

  it("does not recreate notices after sign-out during provider delivery", async () => {
    const provider = Promise.withResolvers<unknown>();
    mocks.sendMessage.mockReturnValueOnce(provider.promise);
    const connectionId = activeConnection.id;

    const pendingResponse = sendRequest({
      body: "The session will close while the provider is pending.",
      subject: "Concurrent sign-out",
      to: [
        { email: "accepted@example.com", name: null },
        { email: "rejected@example.com", name: null },
      ],
    });
    await vi.waitFor(() => expect(mocks.sendMessage).toHaveBeenCalledOnce());

    connectionStore.remove(connectionId);
    provider.resolve({
      deliveryStatus: "partial",
      id: "provider-message-after-sign-out",
      rejectedRecipients: ["rejected@example.com"],
      submittedAt: "2026-07-30T11:59:00.000Z",
    });
    const response = await pendingResponse;

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      data: { deliveryStatus: "partial" },
    });
    expect(connectionStore.get(connectionId)).toBeNull();
    expect(deliveryNoticeStore.list(connectionId)).toEqual([]);
  });

  it("does not convert notice-store failure into a resendable failure", async () => {
    mocks.sendMessage.mockResolvedValueOnce({
      deliveryStatus: "partial",
      id: "provider-message",
      rejectedRecipients: ["rejected@example.com"],
      submittedAt: "2026-07-30T11:59:00.000Z",
    });
    const persistence = vi
      .spyOn(deliveryNoticeStore, "append")
      .mockImplementationOnce(() => {
        throw new Error("simulated store failure");
      });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await sendRequest({
      body: "Store failures must never trigger duplicate delivery.",
      subject: "Terminal partial",
      to: [
        { email: "accepted@example.com", name: null },
        { email: "rejected@example.com", name: null },
      ],
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      data: { deliveryStatus: "partial" },
    });
    expect(mocks.sendMessage).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(
      "[veda-mail] Delivery notice persistence failed.",
    );
    persistence.mockRestore();
    log.mockRestore();
  });
});
