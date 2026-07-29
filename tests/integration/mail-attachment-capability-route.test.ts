import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getMaxAttachmentBytes: vi.fn(async () => 18 * 1024 * 1024),
}));

vi.mock("@/server/connections/connection-session", () => ({
  getCurrentConnection: async () => ({
    id: "attachment-capability-connection",
    providerId: "mock",
  }),
}));
vi.mock("@/server/mail/mail-service", () => ({
  getMailService: async () => ({
    getMaxAttachmentBytes: mocks.getMaxAttachmentBytes,
  }),
}));

import { GET } from "@/app/api/v1/mail/attachments/capability/route";

beforeEach(() => {
  mocks.getMaxAttachmentBytes.mockReset();
  mocks.getMaxAttachmentBytes.mockResolvedValue(18 * 1024 * 1024);
});

describe("attachment capability route", () => {
  it("allows a transient provider probe failure to recover without reloading", async () => {
    mocks.getMaxAttachmentBytes.mockRejectedValueOnce(
      new Error("provider unavailable"),
    );

    await expect(GET().then((response) => response.json())).resolves.toEqual({
      data: { maxAttachmentBytes: null, status: "unavailable" },
    });
    await expect(GET().then((response) => response.json())).resolves.toEqual({
      data: {
        maxAttachmentBytes: 18 * 1024 * 1024,
        status: "available",
      },
    });
  });
});
