import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_MAIL_CONTENT_POLICY } from "@/domain/installation/mail-content-policy";

const mocks = vi.hoisted(() => ({
  connection: vi.fn(),
  getMailContentPolicy: vi.fn(),
  getMaxAttachmentBytes: vi.fn(async () => 18 * 1024 * 1024),
}));
vi.mock("@/server/connections/connection-session", () => ({
  getCurrentConnection: mocks.connection,
}));
vi.mock("@/server/mail/mail-service", () => ({
  getMailService: vi.fn(async () => ({
    getMaxAttachmentBytes: mocks.getMaxAttachmentBytes,
  })),
}));
vi.mock("@/server/organization/mail-content-policy.service", async (original) => ({
  ...(await original()),
  getMailContentPolicy: mocks.getMailContentPolicy,
}));

import { POST } from "@/app/api/v1/mail/attachments/route";
import { id } from "@/domain/shared/brand";
import { connectionStore } from "@/server/connections/connection-store";
import { mailSessionScope } from "@/server/connections/mail-session-scope";

describe("attachment reservation organization policy", () => {
  beforeEach(() => {
    connectionStore.clearAll();
    const connection = connectionStore.create({
      config: {}, displayName: "Policy route", providerId: id.provider("mock"),
    }, "policy-route-revision");
    mocks.connection.mockResolvedValue(connection);
    mocks.getMailContentPolicy.mockResolvedValue({
      ...DEFAULT_MAIL_CONTENT_POLICY, blockedExtensions: ["exe"],
    });
  });

  it("rejects a blocked sanitized extension before provider allocation", async () => {
    const connection = await mocks.connection();
    const response = await POST(new Request("https://mail.example.com/api/v1/mail/attachments", {
      body: JSON.stringify({
        declaredMimeType: "text/plain", draftId: crypto.randomUUID(),
        fileName: "../payload.EXE", size: 5,
      }),
      headers: {
        "content-type": "application/json", host: "mail.example.com",
        origin: "https://mail.example.com",
        "x-veda-mail-session-scope": mailSessionScope(connection),
      },
      method: "POST",
    }));
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "ORGANIZATION_FILE_TYPE_BLOCKED" },
    });
    expect(mocks.getMaxAttachmentBytes).not.toHaveBeenCalled();
  });
});
