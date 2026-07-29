import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getMaxAttachmentBytes: vi.fn(async () => 1_024),
}));

vi.mock("@/server/connections/connection-session", () => ({
  getCurrentConnection: async () => ({
    config: { username: "member@example.com" },
    createdAt: "2026-07-29T00:00:00.000Z",
    displayName: "Mailbox",
    id: "settings-capability-connection",
    providerId: "mock",
  }),
}));
vi.mock("@/server/mail/gateway-cache", () => ({
  resolveGateway: async () => ({
    getAccount: async () => ({ email: "member@example.com", name: "Member" }),
    getMaxAttachmentBytes: mocks.getMaxAttachmentBytes,
    getMemberProfile: async () => ({
      displayName: "Member",
      email: "member@example.com",
    }),
  }),
}));
vi.mock("@/bootstrap/provider-registry", () => ({
  getProviderRegistry: () => ({
    get: () => ({
      manifest: {
        capabilities: {
          maxAttachmentBytes: 18 * 1024 * 1024,
          maxAttachmentDownloadBytes: 50 * 1024 * 1024,
          supportsAttachmentDownload: true,
          supportsDrafts: false,
          supportsPasswordChange: false,
          supportsProfileSettings: false,
          supportsPush: false,
          supportsServerSearch: true,
          supportsThreads: false,
          supportsTwoFactorAuthentication: false,
        },
      },
    }),
  }),
}));
vi.mock("@/server/mail-service/mail-service-profile.store", () => ({
  mailServiceProfileStore: {
    get: async () => ({
      allowedDomains: [],
      config: {},
      displayName: "Mock",
      providerId: "mock",
    }),
  },
}));
vi.mock("@/server/auth/member-two-factor", () => ({
  memberTwoFactorSecurity: { isEnabled: async () => false },
}));

import { GET } from "@/app/api/v1/member/settings/route";

beforeEach(() => {
  mocks.getMaxAttachmentBytes.mockReset();
  mocks.getMaxAttachmentBytes.mockResolvedValue(1_024);
});

const settings = async () => {
  const response = await GET();
  expect(response.status).toBe(200);
  return (await response.json()) as {
    data: {
      attachmentCapability: { status: string };
      capabilities: {
        mail: {
          maxAttachmentBytes: number;
          maxAttachmentDownloadBytes: number;
          supportsAttachmentDownload: boolean;
        };
      };
    };
  };
};

describe("member settings attachment capability", () => {
  it("reports the live lower provider limit instead of the manifest default", async () => {
    await expect(settings()).resolves.toMatchObject({
      data: {
        attachmentCapability: { status: "available" },
        capabilities: {
          mail: {
            maxAttachmentBytes: 1_024,
            maxAttachmentDownloadBytes: 50 * 1024 * 1024,
            supportsAttachmentDownload: true,
          },
        },
      },
    });
  });

  it("distinguishes unsupported and temporarily unavailable capability states", async () => {
    mocks.getMaxAttachmentBytes.mockResolvedValueOnce(0);
    await expect(settings()).resolves.toMatchObject({
      data: {
        attachmentCapability: { status: "unsupported" },
        capabilities: { mail: { maxAttachmentBytes: 0 } },
      },
    });

    mocks.getMaxAttachmentBytes.mockRejectedValueOnce(
      new Error("provider unavailable"),
    );
    await expect(settings()).resolves.toMatchObject({
      data: {
        attachmentCapability: { status: "unavailable" },
        capabilities: { mail: { maxAttachmentBytes: 0 } },
      },
    });
  });
});
