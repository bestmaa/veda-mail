import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  providerUploadReference: vi.fn(),
  upload: vi.fn(),
}));
vi.mock("@/infrastructure/providers/stalwart-jmap/jmap-attachment-transport", () => ({
  JmapAttachmentTransport: class {
    public upload = mocks.upload;
    public providerUploadReference = mocks.providerUploadReference;
  },
}));
vi.mock("@/infrastructure/providers/stalwart-jmap/jmap-outgoing-attachment", () => ({
  maximumJmapUploadBytes: vi.fn(() => 1024),
}));
vi.mock("@/infrastructure/providers/stalwart-jmap/provider-url-policy", () => ({
  assertSafeProviderOrigin: vi.fn(async () => ({ origin: "https://mail.example.com" })),
}));

import { id } from "@/domain/shared/brand";
import { importStalwartMessageSource } from "@/infrastructure/providers/stalwart-jmap/stalwart-message-source-import";

const session = {
  accounts: {}, apiUrl: "https://mail.example.com/jmap",
  capabilities: {}, downloadUrl: "https://mail.example.com/download/{accountId}/{blobId}/{name}",
  primaryAccounts: {}, uploadUrl: "https://mail.example.com/upload/{accountId}",
  username: "member@example.com",
};
const client = {
  authorizationForProviderTransport: vi.fn(async () => "Basic safe"),
  getSession: vi.fn(async () => session),
  request: vi.fn(),
  result: vi.fn(),
};

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  client.request.mockReset(); client.result.mockReset();
  mocks.upload.mockResolvedValue({});
  mocks.providerUploadReference.mockReturnValue({
    blobId: "blob-one", size: 20, type: "message/rfc822",
  });
  client.request.mockResolvedValue({});
  client.result.mockReturnValue({
    accountId: "account-one", created: { import: { id: "email-one" } },
  });
});

describe("JMAP RFC 5322 import", () => {
  it("uploads message/rfc822 then imports the blob into the exact mailbox", async () => {
    const source = new TextEncoder().encode("From: a@example.com\r\n\r\nHello\r\n");
    await expect(importStalwartMessageSource(
      client as never,
      { authType: "basic", baseUrl: "https://mail.example.com", secret: "x", username: "member@example.com" },
      "account-one",
      { mailboxId: id.mailbox("archive-one"), source },
    )).resolves.toEqual({ messageId: "email-one" });
    expect(mocks.upload).toHaveBeenCalledWith(expect.objectContaining({
      accountId: "account-one", body: source, mediaType: "message/rfc822",
    }));
    expect(client.request).toHaveBeenCalledWith([["Email/import", {
      accountId: "account-one",
      emails: { import: {
        blobId: "blob-one", keywords: {}, mailboxIds: { "archive-one": true },
      } },
    }, "message-import"]], ["urn:ietf:params:jmap:mail"], undefined);
  });

  it("fails closed on provider rejection or account substitution", async () => {
    client.result.mockReturnValueOnce({ accountId: "account-one", notCreated: { import: {} } });
    await expect(importStalwartMessageSource(client as never, {
      authType: "basic", baseUrl: "https://mail.example.com", secret: "x", username: "member@example.com",
    }, "account-one", { mailboxId: id.mailbox("inbox"), source: new Uint8Array([1]) }))
      .rejects.toMatchObject({ code: "provider_rejected" });
    client.result.mockReturnValueOnce({ accountId: "other", created: { import: { id: "email" } } });
    await expect(importStalwartMessageSource(client as never, {
      authType: "basic", baseUrl: "https://mail.example.com", secret: "x", username: "member@example.com",
    }, "account-one", { mailboxId: id.mailbox("inbox"), source: new Uint8Array([1]) }))
      .rejects.toMatchObject({ code: "provider_failure" });
  });
});
