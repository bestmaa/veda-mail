import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MailUserAdministrationError } from "@/domain/admin/mail-user";
import { id } from "@/domain/shared/brand";
import { mailServiceProfileRevision } from "@/server/mail-service/mail-service-profile-revision";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  factory: vi.fn(),
  get: vi.fn(),
  getUser: vi.fn(),
  list: vi.fn(),
  availability: vi.fn(),
}));

vi.mock("@/server/installation/installation.store", () => ({
  installationStore: { get: mocks.get },
}));
vi.mock(
  "@/infrastructure/providers/stalwart-jmap/stalwart-mail-user-administrator",
  () => ({ createStalwartMailUserAdministrator: mocks.factory }),
);

import {
  createAdminMailUser,
  getAdminMailUser,
  getAdminMailUsersSnapshot,
} from "@/server/mail-users/mail-user-administration";

const originalApiKey = process.env["VEDA_MAIL_STALWART_MANAGEMENT_API_KEY"];
const originalManagementOrigin =
  process.env["VEDA_MAIL_STALWART_MANAGEMENT_ORIGIN"];
const profile = (providerId = "stalwart-jmap") => ({
  mailProfile: {
    allowedDomains: ["example.com", "example.org"],
    config: { baseUrl: "https://mail.example.com" },
    createdAt: "2026-07-31T00:00:00.000Z",
    displayName: "Example",
    providerId: id.provider(providerId),
    updatedAt: "2026-07-31T00:00:00.000Z",
    version: 1 as const,
  },
  owner: { twoFactor: null },
});
const user = {
  aliases: [],
  createdAt: null,
  displayName: null,
  email: "ada@example.com",
  id: "account-1",
  locale: null,
  maxDiskQuota: null,
  timeZone: null,
  usedDiskQuota: 0,
};
const currentProfileRevision = (): string =>
  mailServiceProfileRevision(profile().mailProfile);

beforeEach(() => {
  vi.clearAllMocks();
  process.env["VEDA_MAIL_STALWART_MANAGEMENT_API_KEY"] = "server-secret-key";
  process.env["VEDA_MAIL_STALWART_MANAGEMENT_ORIGIN"] =
    "https://mail.example.com";
  mocks.get.mockResolvedValue(profile());
  mocks.factory.mockReturnValue({
    createUser: mocks.create,
    getCreationAvailability: mocks.availability,
    getUser: mocks.getUser,
    listUsers: mocks.list,
  });
  mocks.availability.mockResolvedValue({ available: true });
  mocks.list.mockResolvedValue({ items: [] });
  mocks.getUser.mockResolvedValue(user);
  mocks.create.mockResolvedValue({ outcome: "created", user });
});

afterEach(() => {
  if (originalApiKey === undefined) {
    delete process.env["VEDA_MAIL_STALWART_MANAGEMENT_API_KEY"];
  } else {
    process.env["VEDA_MAIL_STALWART_MANAGEMENT_API_KEY"] = originalApiKey;
  }
  if (originalManagementOrigin === undefined) {
    delete process.env["VEDA_MAIL_STALWART_MANAGEMENT_ORIGIN"];
  } else {
    process.env["VEDA_MAIL_STALWART_MANAGEMENT_ORIGIN"] =
      originalManagementOrigin;
  }
});

describe("mailbox user administration service", () => {
  it("reports unsupported and unconfigured capabilities without a secret leak", async () => {
    mocks.get.mockResolvedValueOnce(profile("imap-smtp"));
    await expect(getAdminMailUsersSnapshot({})).resolves.toMatchObject({
      creation: { available: false },
      status: "unsupported",
      users: [],
    });
    expect(mocks.factory).not.toHaveBeenCalled();

    delete process.env["VEDA_MAIL_STALWART_MANAGEMENT_API_KEY"];
    await expect(getAdminMailUsersSnapshot({})).resolves.toMatchObject({
      creation: { available: false },
      status: "unconfigured",
      users: [],
    });
    expect(mocks.factory).not.toHaveBeenCalled();
  });

  it("passes the management key only to the server-side adapter", async () => {
    mocks.availability.mockResolvedValueOnce({
      available: false,
      reason: "external-directory",
    });
    const snapshot = await getAdminMailUsersSnapshot({
      domain: "example.org",
      search: "ada",
    });
    expect(mocks.factory).toHaveBeenCalledWith({
      allowedDomains: ["example.com", "example.org"],
      apiKey: "server-secret-key",
      baseUrl: "https://mail.example.com",
      expectedOrigin: "https://mail.example.com",
    });
    expect(mocks.list).toHaveBeenCalledWith({
      domain: "example.org",
      limit: 50,
      query: "ada",
    });
    expect(snapshot).toMatchObject({
      creation: {
        available: false,
        reason: expect.stringContaining("external directory"),
      },
      status: "available",
    });
    expect(JSON.stringify(snapshot)).not.toContain("server-secret-key");
  });

  it("never sends a management key to a profile with another origin", async () => {
    process.env["VEDA_MAIL_STALWART_MANAGEMENT_ORIGIN"] =
      "https://old-mail.example.com";

    await expect(getAdminMailUsersSnapshot({})).rejects.toMatchObject({
      code: "MAIL_USER_ADMIN_CONFIGURATION",
      status: 503,
    });
    expect(mocks.factory).not.toHaveBeenCalled();
  });

  it("rejects every mailbox operation outside configured domains", async () => {
    await expect(
      getAdminMailUsersSnapshot({ domain: "evil.example" }),
    ).rejects.toMatchObject({ code: "MAIL_USER_DOMAIN_FORBIDDEN", status: 403 });
    await expect(
      getAdminMailUser("evil.example", "account-1"),
    ).rejects.toMatchObject({ code: "MAIL_USER_DOMAIN_FORBIDDEN", status: 403 });
    await expect(
      createAdminMailUser(
        {
          email: "ada@evil.example",
          password: "Password 123",
        },
        currentProfileRevision(),
      ),
    ).rejects.toMatchObject({ code: "MAIL_USER_DOMAIN_FORBIDDEN", status: 403 });
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("maps provider failures without reflecting provider messages", async () => {
    mocks.getUser.mockRejectedValueOnce(
      new MailUserAdministrationError(
        "provider-auth",
        "Bearer secret-token was rejected by upstream",
      ),
    );
    const failure = await getAdminMailUser("example.com", "account-1").catch(
      (error: unknown) => error,
    );
    expect(failure).toMatchObject({
      code: "MAIL_USER_PROVIDER_AUTH",
      status: 503,
    });
    expect(String((failure as Error).message)).not.toContain("secret-token");
  });

  it("uses 503 when Stalwart administration is not configured", async () => {
    delete process.env["VEDA_MAIL_STALWART_MANAGEMENT_API_KEY"];
    await expect(
      createAdminMailUser(
        {
          email: "ada@example.com",
          password: "Password 123",
        },
        currentProfileRevision(),
      ),
    ).rejects.toMatchObject({
      code: "MAIL_USER_ADMIN_UNCONFIGURED",
      status: 503,
    });
  });

  it("aborts before adapter construction when the mail profile changed", async () => {
    await expect(
      createAdminMailUser(
        { email: "ada@example.com", password: "Password 123" },
        "stale-profile-revision",
      ),
    ).rejects.toMatchObject({ code: "MAIL_USER_PROFILE_CHANGED", status: 409 });
    expect(mocks.factory).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
