import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connection: { id: "stalwart-route-connection" },
  getCurrentConnection: vi.fn(),
  getMailService: vi.fn(),
}));

vi.mock("@/infrastructure/providers/stalwart-jmap/provider-url-policy", () => ({
  assertSafeProviderOrigin: async (value: string) => new URL(value),
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

import { GET } from "@/app/api/v1/mail/messages/[messageId]/attachments/[attachmentId]/route";
import { MailApplicationService } from "@/application/services/mail-application.service";
import { id } from "@/domain/shared/brand";
import { StalwartMailGateway } from "@/infrastructure/providers/stalwart-jmap/stalwart-mail.gateway";
import { bindJmapReceivedAttachments } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-attachment";
import {
  JMAP_CORE,
  JMAP_MAIL,
  type JmapEmail,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";
import { mailSessionScope } from "@/server/connections/mail-session-scope";

const origin = "https://mail.example.com";
const messageId = id.message("stalwart-message");
const bytes = Uint8Array.of(0, 255, 17, 34, 128);
const config = {
  authType: "basic" as const,
  baseUrl: origin,
  secret: "provider-secret",
  username: "member@example.com",
};
const email: JmapEmail = {
  attachments: [{
    blobId: "private-provider-blob",
    disposition: "attachment",
    name: "route-report.bin",
    partId: "private-provider-part",
    size: bytes.byteLength,
    type: "application/octet-stream",
  }],
  hasAttachment: true,
  id: messageId,
  keywords: {},
  mailboxIds: { inbox: true },
  preview: "",
  receivedAt: "2026-08-01T00:00:00.000Z",
  size: bytes.byteLength,
  subject: "Attachment",
  threadId: "thread-one",
};
const attachmentId = bindJmapReceivedAttachments("account-one", email)[0]
  ?.metadata.id;
if (!attachmentId) throw new Error("Missing Stalwart attachment fixture.");

const session = {
  accounts: { "account-one": { isReadOnly: false, name: "Member" } },
  apiUrl: `${origin}/jmap`,
  capabilities: { [JMAP_CORE]: { maxSizeUpload: 25_000_000 } },
  downloadUrl:
    `${origin}/download/{accountId}/{blobId}/{name}?type={type}`,
  primaryAccounts: { [JMAP_MAIL]: "account-one" },
  uploadUrl: `${origin}/upload/{accountId}`,
  username: "member@example.com",
};

const request = (
  selectedAttachmentId: string = attachmentId,
  init: RequestInit = {},
) => new Request(
  `${origin}/api/v1/mail/messages/${messageId}/attachments/${selectedAttachmentId}`,
  {
    ...init,
    headers: {
      host: "mail.example.com",
      origin,
      "x-veda-mail-session-scope": mailSessionScope(mocks.connection),
      ...init.headers,
    },
  },
);
const context = (selectedAttachmentId: string = attachmentId) => ({
  params: Promise.resolve({
    attachmentId: selectedAttachmentId,
    messageId,
  }),
});

const providerFetch = () => vi.fn(async (input: string | URL | Request) => {
  const url = new URL(String(input));
  if (url.pathname === "/.well-known/jmap") return Response.json(session);
  if (url.pathname === "/jmap") {
    return Response.json({
      methodResponses: [[
        "Email/get",
        { accountId: "account-one", list: [email], state: "state-one" },
        "attachment-email",
      ]],
      sessionState: "state-one",
    });
  }
  if (url.pathname.includes("/download/")) {
    return new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 2));
        controller.enqueue(bytes.slice(2));
        controller.close();
      },
    }));
  }
  throw new Error(`Unexpected provider request: ${url.pathname}`);
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentConnection.mockResolvedValue(mocks.connection);
  mocks.getMailService.mockResolvedValue(
    new MailApplicationService(new StalwartMailGateway(config)),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe("Stalwart attachment route adapter integration", () => {
  it("gates scope, revalidates the opaque ID, and preserves provider bytes", async () => {
    const fetchMock = providerFetch();
    vi.stubGlobal("fetch", fetchMock);

    const stale = await GET(request(attachmentId, {
      headers: { "x-veda-mail-session-scope": "stale-scope" },
    }), context());
    expect(stale.status).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();

    const response = await GET(request(), context());
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    const providerUrls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(providerUrls.some((url) => url.includes("private-provider-blob")))
      .toBe(true);
    expect(request().url).not.toContain("private-provider-blob");
  });

  it("rejects a guessed opaque ID before requesting provider bytes", async () => {
    const fetchMock = providerFetch();
    vi.stubGlobal("fetch", fetchMock);
    const guessed = "message-attachment-guessed";

    const response = await GET(request(guessed), context(guessed));

    expect(response.status).toBe(404);
    expect(fetchMock.mock.calls.map(([input]) => String(input)))
      .not.toEqual(expect.arrayContaining([
        expect.stringContaining("/download/"),
      ]));
  });

  it("maps a caller abort before provider access", async () => {
    const fetchMock = providerFetch();
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    controller.abort();

    const response = await GET(
      request(attachmentId, { signal: controller.signal }),
      context(),
    );

    expect(response.status).toBe(499);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "ATTACHMENT_DOWNLOAD_ABORTED" },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
