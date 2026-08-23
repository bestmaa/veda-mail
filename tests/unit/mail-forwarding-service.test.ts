import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apply: vi.fn(),
  getInstallation: vi.fn(),
  getLedger: vi.fn(),
  inspect: vi.fn(),
  putLedger: vi.fn(), validate: vi.fn(),
}));

vi.mock("@/infrastructure/providers/stalwart-jmap/stalwart-mail-forwarding-administrator", () => ({
  StalwartMailForwardingAdministrator: class {
    apply = mocks.apply;
    inspect = mocks.inspect;
    validate = mocks.validate;
  },
}));
vi.mock("@/server/installation/installation.store", () => ({
  installationStore: { get: mocks.getInstallation },
}));
vi.mock("@/server/mail-forwarding/mail-forwarding.store", () => ({
  mailForwardingStore: { get: mocks.getLedger, put: mocks.putLedger },
}));

import type { MailForwardingLedger } from "@/server/mail-forwarding/mail-forwarding.schema";
import {
  getMailForwardingSnapshot,
  removeMailForwarding,
  setMailForwarding,
} from "@/server/mail-forwarding/mail-forwarding.service";

const originalApiKey = process.env["VEDA_MAIL_STALWART_MANAGEMENT_API_KEY"];
const originalOrigin = process.env["VEDA_MAIL_STALWART_MANAGEMENT_ORIGIN"];
const emptyLedger = (): MailForwardingLedger => ({
  entries: [], revision: 0,
  updatedAt: "1970-01-01T00:00:00.000Z", version: 1 as const,
});
const installation = {
  mailProfile: {
    allowedDomains: ["example.com"],
    config: { baseUrl: "https://mail.example.com/jmap" },
    providerId: "stalwart-jmap",
  },
};

let ledger = emptyLedger();

beforeEach(() => {
  vi.clearAllMocks();
  process.env["VEDA_MAIL_STALWART_MANAGEMENT_API_KEY"] = "scoped-secret";
  process.env["VEDA_MAIL_STALWART_MANAGEMENT_ORIGIN"] = "https://mail.example.com";
  ledger = emptyLedger();
  mocks.getInstallation.mockResolvedValue(installation);
  mocks.getLedger.mockImplementation(async () => ledger);
  mocks.putLedger.mockImplementation(async (expectedRevision, next) => {
    if (ledger.revision !== expectedRevision) return false;
    ledger = next;
    return true;
  });
  mocks.inspect.mockResolvedValue("available");
  mocks.apply.mockResolvedValue(undefined);
  mocks.validate.mockReturnValue(undefined);
});

describe("administrator-managed mail forwarding service", () => {
  it("advertises fail-closed availability when management capability is unconfigured", async () => {
    delete process.env["VEDA_MAIL_STALWART_MANAGEMENT_API_KEY"];

    await expect(getMailForwardingSnapshot("ada@example.com")).resolves.toMatchObject({
      availability: "unconfigured", configuration: null, revision: 0,
    });
    await expect(setMailForwarding(
      "ada@example.com", ["ada@example.com"], "ada@gmail.com", 0,
    )).rejects.toMatchObject({ code: "MAIL_FORWARDING_UNAVAILABLE", status: 409 });
    expect(mocks.apply).not.toHaveBeenCalled();
    expect(mocks.putLedger).not.toHaveBeenCalled();
  });

  it.each(["ada@example.com", "other@example.com"])(
    "rejects a loop-risk destination %s before durable or provider mutation",
    async (destinationEmail) => {
      await expect(setMailForwarding(
        "ada@example.com", ["ada@example.com"], destinationEmail, 0,
      )).rejects.toMatchObject({ code: "MAIL_FORWARDING_LOOP_RISK", status: 400 });
      expect(mocks.putLedger).not.toHaveBeenCalled();
      expect(mocks.apply).not.toHaveBeenCalled();
    },
  );

  it("rejects an exact alias destination outside the configured domain list", async () => {
    await expect(setMailForwarding(
      "ada@example.com", ["ada@example.com", "archive@legacy.example"],
      "archive@legacy.example", 0,
    )).rejects.toMatchObject({ code: "MAIL_FORWARDING_LOOP_RISK", status: 400 });
    expect(mocks.putLedger).not.toHaveBeenCalled();
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it("persists applying intent, applies the complete ledger, and then marks it active", async () => {
    const result = await setMailForwarding(
      "ada@example.com", ["ada@example.com", "team@example.com"],
      "ada@gmail.com", 0,
    );

    expect(mocks.putLedger).toHaveBeenCalledTimes(2);
    expect(mocks.validate).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ destinationEmail: "ada@gmail.com" }),
    ]));
    expect(mocks.putLedger.mock.calls[0]?.[1]).toMatchObject({
      entries: [{ destinationEmail: "ada@gmail.com", keepLocalCopy: true,
        sourceEmail: "ada@example.com", status: "applying" }],
      revision: 1,
    });
    expect(mocks.apply).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ destinationEmail: "ada@gmail.com", status: "applying" }),
    ]));
    expect(result).toMatchObject({
      entries: [{ destinationEmail: "ada@gmail.com", status: "active" }],
      revision: 2,
    });
  });

  it("rejects provider program capacity before durable mutation", async () => {
    mocks.validate.mockImplementationOnce(() => {
      throw new RangeError("private provider limit");
    });

    await expect(setMailForwarding(
      "ada@example.com", ["ada@example.com"], "ada@gmail.com", 0,
    )).rejects.toMatchObject({ code: "MAIL_FORWARDING_CAPACITY", status: 409 });
    expect(mocks.putLedger).not.toHaveBeenCalled();
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it("retains desired configuration with error status when provider apply fails", async () => {
    mocks.apply.mockRejectedValueOnce(new Error("provider offline"));

    await expect(setMailForwarding(
      "ada@example.com", ["ada@example.com"], "ada@gmail.com", 0,
    )).rejects.toMatchObject({
      code: "MAIL_FORWARDING_PROVIDER_UNAVAILABLE", status: 503,
    });
    expect(ledger.entries).toEqual([
      expect.objectContaining({ destinationEmail: "ada@gmail.com", status: "error" }),
    ]);
  });

  it("restores a failed disable as error instead of falsely claiming it stopped", async () => {
    ledger = {
      entries: [{
        destinationEmail: "ada@gmail.com", keepLocalCopy: true as const,
        sourceAddresses: ["ada@example.com"], sourceEmail: "ada@example.com",
        status: "active" as const, updatedAt: "2026-08-23T00:00:00.000Z",
      }],
      revision: 4, updatedAt: "2026-08-23T00:00:00.000Z", version: 1 as const,
    };
    mocks.apply.mockRejectedValueOnce(new Error("provider offline"));

    await expect(removeMailForwarding("ada@example.com", 4)).rejects.toMatchObject({
      code: "MAIL_FORWARDING_PROVIDER_UNAVAILABLE", status: 503,
    });
    expect(ledger.entries).toEqual([
      expect.objectContaining({ destinationEmail: "ada@gmail.com", status: "error" }),
    ]);
  });

  it("does not mark a newer enable as failed after an older replica loses a race", async () => {
    mocks.apply.mockImplementationOnce(async () => {
      ledger = {
        entries: [{
          destinationEmail: "newer@outlook.com", keepLocalCopy: true,
          sourceAddresses: ["ada@example.com"], sourceEmail: "ada@example.com",
          status: "active", updatedAt: "2026-08-24T00:00:00.000Z",
        }],
        revision: 2, updatedAt: "2026-08-24T00:00:00.000Z", version: 1,
      };
      throw new Error("older provider apply failed");
    });

    await expect(setMailForwarding(
      "ada@example.com", ["ada@example.com"], "older@gmail.com", 0,
    )).rejects.toMatchObject({ code: "MAIL_FORWARDING_PROVIDER_UNAVAILABLE" });
    expect(ledger.entries[0]).toMatchObject({
      destinationEmail: "newer@outlook.com", status: "active",
    });
    expect(mocks.putLedger).toHaveBeenCalledTimes(1);
  });

  it("does not restore an old destination over a newer enable", async () => {
    ledger = {
      entries: [{
        destinationEmail: "old@gmail.com", keepLocalCopy: true,
        sourceAddresses: ["ada@example.com"], sourceEmail: "ada@example.com",
        status: "active", updatedAt: "2026-08-23T00:00:00.000Z",
      }],
      revision: 4, updatedAt: "2026-08-23T00:00:00.000Z", version: 1,
    };
    mocks.apply.mockImplementationOnce(async () => {
      ledger = {
        entries: [{
          destinationEmail: "newer@outlook.com", keepLocalCopy: true,
          sourceAddresses: ["ada@example.com"], sourceEmail: "ada@example.com",
          status: "active", updatedAt: "2026-08-24T00:00:00.000Z",
        }],
        revision: 6, updatedAt: "2026-08-24T00:00:00.000Z", version: 1,
      };
      throw new Error("older disable apply failed");
    });

    await expect(removeMailForwarding("ada@example.com", 4)).rejects.toMatchObject({
      code: "MAIL_FORWARDING_PROVIDER_UNAVAILABLE",
    });
    expect(ledger.entries[0]).toMatchObject({
      destinationEmail: "newer@outlook.com", status: "active",
    });
    expect(mocks.putLedger).toHaveBeenCalledTimes(1);
  });
});

afterAll(() => {
  if (originalApiKey === undefined) delete process.env["VEDA_MAIL_STALWART_MANAGEMENT_API_KEY"];
  else process.env["VEDA_MAIL_STALWART_MANAGEMENT_API_KEY"] = originalApiKey;
  if (originalOrigin === undefined) delete process.env["VEDA_MAIL_STALWART_MANAGEMENT_ORIGIN"];
  else process.env["VEDA_MAIL_STALWART_MANAGEMENT_ORIGIN"] = originalOrigin;
});
