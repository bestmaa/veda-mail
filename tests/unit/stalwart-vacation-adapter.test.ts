import { describe, expect, it, vi } from "vitest";

import { JMAP_VACATION_RESPONSE } from "@/domain/mail/vacation";
import { StalwartVacationAdapter } from "@/infrastructure/providers/stalwart-jmap/stalwart-vacation-adapter";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import { JMAP_MAIL } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

const accountId = "account-1";
const session = (supported = true) => ({
  accounts: { [accountId]: {
    accountCapabilities: supported ? { [JMAP_VACATION_RESPONSE]: {} } : {},
    isReadOnly: false, name: "Member",
  } },
  apiUrl: "https://mail.example.test/jmap",
  capabilities: supported ? { [JMAP_VACATION_RESPONSE]: {} } : {},
  downloadUrl: "https://mail.example.test/download",
  primaryAccounts: supported ? {
    [JMAP_MAIL]: accountId, [JMAP_VACATION_RESPONSE]: accountId,
  } : { [JMAP_MAIL]: accountId },
  uploadUrl: "https://mail.example.test/upload",
  username: "member@example.test",
});

const client = (payloads: unknown[] = []) => {
  const request = vi.fn();
  const result = vi.fn((_response, _callId, _method, schema) =>
    schema.parse(payloads.shift()));
  return { getSession: vi.fn(async () => session()), request, result
  } as unknown as StalwartJmapClient;
};

describe("Stalwart JMAP vacation adapter", () => {
  it("advertises support only for a writable primary mail account", async () => {
    const value = client();
    await expect(new StalwartVacationAdapter(value).getCapability())
      .resolves.toEqual({ supported: true });
    vi.mocked(value.getSession).mockResolvedValue(session(false));
    await expect(new StalwartVacationAdapter(value).getCapability())
      .resolves.toMatchObject({ supported: false });
  });

  it("reads the singleton with its provider revision", async () => {
    const value = client([{
      accountId, list: [{ fromDate: null, htmlBody: null, id: "singleton",
        isEnabled: true, subject: "Away", textBody: "Back soon", toDate: null }],
      notFound: [], state: "state-1",
    }]);
    await expect(new StalwartVacationAdapter(value).get()).resolves.toEqual({
      fromDate: null, htmlBody: null, isEnabled: true, revision: "state-1",
      subject: "Away", textBody: "Back soon", toDate: null,
    });
    expect(vi.mocked(value.request)).toHaveBeenCalledWith(
      [["VacationResponse/get", { accountId, ids: ["singleton"] }, "vacation-get"]],
      [JMAP_VACATION_RESPONSE],
    );
  });

  it("fails closed when the provider returns a non-canonical date", async () => {
    const value = client([{
      accountId, list: [{ fromDate: "2026-08-09T10:30:00+05:30", id: "singleton",
        isEnabled: true }], state: "state-1",
    }]);
    await expect(new StalwartVacationAdapter(value).get()).rejects.toThrow();
  });

  it("uses ifInState and accepts a null-valued updated map entry", async () => {
    const value = client([{
      accountId, newState: "state-2", notUpdated: {}, oldState: "state-1",
      updated: { singleton: null },
    }]);
    const input = { expectedRevision: "state-1", fromDate: null,
      htmlBody: null, isEnabled: false, subject: null, textBody: null, toDate: null };
    await expect(new StalwartVacationAdapter(value).set(input)).resolves
      .toMatchObject({ isEnabled: false, revision: "state-2" });
    expect(vi.mocked(value.request)).toHaveBeenCalledWith(
      [["VacationResponse/set", expect.objectContaining({
        accountId, ifInState: "state-1",
      }), "vacation-set"]], [JMAP_VACATION_RESPONSE],
    );
  });

  it("fails closed on a stale or rejected update", async () => {
    const value = client([{
      accountId, newState: "state-2", notUpdated: { singleton: { type: "stateMismatch" } },
      oldState: "state-other", updated: {},
    }]);
    await expect(new StalwartVacationAdapter(value).set({
      expectedRevision: "state-1", fromDate: null, htmlBody: null,
      isEnabled: false, subject: null, textBody: null, toDate: null,
    })).rejects.toMatchObject({ code: "VACATION_RESPONSE_CONFLICT", status: 409 });
  });
});
