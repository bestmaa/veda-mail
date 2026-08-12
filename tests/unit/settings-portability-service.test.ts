import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_MESSAGE_LIST_PREFERENCES } from "@/domain/mail/message-list-preferences";
import { id } from "@/domain/shared/brand";

const mocks = vi.hoisted(() => ({
  getAccount: vi.fn(),
  getMailService: vi.fn(),
  listLabels: vi.fn(),
  listMailboxes: vi.fn(),
  preferencesGet: vi.fn(),
  preferencesSet: vi.fn(),
  readRuleWorkspace: vi.fn(),
  replaceAndDeployRules: vi.fn(),
}));

vi.mock("@/server/mail/mail-service", () => ({
  getMailService: mocks.getMailService,
}));
vi.mock("@/server/labels/label-catalog.store", () => ({
  labelCatalogStore: { list: mocks.listLabels },
}));
vi.mock("@/server/preferences/message-list-preferences.store", () => ({
  messageListPreferencesStore: {
    get: mocks.preferencesGet,
    set: mocks.preferencesSet,
  },
}));
vi.mock("@/server/rules/rule-deployment.service", () => ({
  readRuleWorkspace: mocks.readRuleWorkspace,
  replaceAndDeployRules: mocks.replaceAndDeployRules,
}));

import { importPortableSettings } from "@/server/portability/settings-portability.service";

const connection = {
  config: {}, createdAt: "2026-08-12T00:00:00.000Z", displayName: "Mail",
  id: id.connection("portability-service-connection"),
  providerId: id.provider("mock"),
};
const inbox = {
  color: "#64748b", id: id.mailbox("inbox"), name: "Inbox", parentId: null,
  rights: { mayAddItems: true, mayCreateChild: false, mayDelete: false,
    mayRename: false },
  role: "inbox" as const, sortOrder: 0, total: 0, unread: 0,
};
const emptyBook = {
  audit: [],
  deployment: { status: "undeployed" },
  revision: null,
  rules: [],
  version: 1 as const,
};
const bundle = (rules: readonly unknown[] = []) => ({
  exportedAt: "2026-08-12T00:00:00.000Z",
  format: "veda-mail/settings" as const,
  preferences: { ...DEFAULT_MESSAGE_LIST_PREFERENCES, density: "compact" as const },
  rules,
  version: 1 as const,
});

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.getAccount.mockResolvedValue({ email: "member@example.com", providerId: "mock" });
  mocks.listMailboxes.mockResolvedValue([inbox]);
  mocks.getMailService.mockResolvedValue({
    getAccount: mocks.getAccount,
    listMailboxes: mocks.listMailboxes,
  });
  mocks.listLabels.mockResolvedValue([]);
  mocks.preferencesGet.mockResolvedValue(DEFAULT_MESSAGE_LIST_PREFERENCES);
  mocks.preferencesSet.mockImplementation(async (_owner, preferences) => preferences);
  mocks.readRuleWorkspace.mockResolvedValue({
    book: emptyBook,
    capability: { supported: true },
  });
  mocks.replaceAndDeployRules.mockResolvedValue({ ...emptyBook, revision: "next" });
});

describe("settings portability service", () => {
  it("supports preference-only transfer when the provider has no rules", async () => {
    mocks.readRuleWorkspace.mockResolvedValue({
      book: emptyBook,
      capability: { reason: "Unsupported", supported: false },
    });
    await expect(importPortableSettings(connection, bundle() as never)).resolves
      .toMatchObject({ preferences: { density: "compact" } });
    expect(mocks.replaceAndDeployRules).not.toHaveBeenCalled();
    expect(mocks.preferencesSet).toHaveBeenCalledOnce();
  });

  it("deploys resolved rules before committing preferences", async () => {
    const calls: string[] = [];
    mocks.replaceAndDeployRules.mockImplementation(async () => {
      calls.push("rules");
      return { ...emptyBook, revision: "next" };
    });
    mocks.preferencesSet.mockImplementation(async (_owner, preferences) => {
      calls.push("preferences");
      return preferences;
    });
    await importPortableSettings(connection, bundle([{
      actions: [{ kind: "move", target: { role: "inbox", type: "role" } }],
      conditions: [{ kind: "subject", operator: "contains", value: "invoice" }],
      enabled: true, match: "all", name: "Invoices", stopProcessing: true,
    }]) as never);
    expect(calls).toEqual(["rules", "preferences"]);
    expect(mocks.replaceAndDeployRules).toHaveBeenCalledWith(connection, [
      expect.objectContaining({ actions: [{ kind: "move", mailboxId: inbox.id }] }),
    ]);
  });

  it("does not mutate either store when a portable target is unavailable", async () => {
    await expect(importPortableSettings(connection, bundle([{
      actions: [{ kind: "label", name: "Missing" }],
      conditions: [{ kind: "subject", operator: "contains", value: "invoice" }],
      enabled: true, match: "all", name: "Missing", stopProcessing: false,
    }]) as never)).rejects.toMatchObject({ code: "SETTINGS_IMPORT_TARGET_MISSING" });
    expect(mocks.replaceAndDeployRules).not.toHaveBeenCalled();
    expect(mocks.preferencesSet).not.toHaveBeenCalled();
  });
});
