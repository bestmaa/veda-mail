import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deployRules: vi.fn(),
  get: vi.fn(),
  getAccount: vi.fn(),
  getRuleCapability: vi.fn(),
  persistDeploymentIntent: vi.fn(),
  put: vi.fn(),
  resolveGateway: vi.fn(),
}));

vi.mock("@/server/mail/gateway-cache", () => ({
  resolveGateway: mocks.resolveGateway,
}));
vi.mock("@/server/rules/rule-store", () => ({
  ruleStore: {
    get: mocks.get,
    persistDeploymentIntent: mocks.persistDeploymentIntent,
    put: mocks.put,
  },
}));

import type { MailRulePutOperation } from "@/domain/mail/rule";
import { id } from "@/domain/shared/brand";
import { ManageSieveError } from "@/infrastructure/providers/imap-smtp/manage-sieve-errors";
import {
  mutateAndDeployRules,
  replaceAndDeployRules,
} from "@/server/rules/rule-deployment.service";

const connection = {
  config: { secret: "private" }, createdAt: "2026-08-04T00:00:00.000Z",
  displayName: "Mail", id: id.connection("rule-deployment-connection"),
  providerId: id.provider("stalwart-jmap"),
};
const desiredRevision = "11111111-1111-4111-8111-111111111111";
const pendingRevision = "22222222-2222-4222-8222-222222222222";
const intentId = "33333333-3333-4333-8333-333333333333";
const operation: MailRulePutOperation = {
  definition: {
    actions: [{ kind: "star" }],
    conditions: [{ kind: "subject", operator: "contains", value: "invoice" }],
    enabled: true, match: "all", name: "Invoices", stopProcessing: false,
  },
  expectedRevision: null,
  operation: "create",
};
const desired = {
  audit: [],
  deployment: { providerState: "provider-state", status: "undeployed" },
  revision: desiredRevision,
  rules: [],
  version: 1,
};
const pending = {
  ...desired,
  deployment: { providerState: "provider-state", status: "pending" },
  revision: pendingRevision,
};

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.resolveGateway.mockResolvedValue({
    deployRules: mocks.deployRules,
    getAccount: mocks.getAccount,
    getRuleCapability: mocks.getRuleCapability,
  });
  mocks.getAccount.mockResolvedValue({ email: "member@example.com" });
  mocks.getRuleCapability.mockResolvedValue({ supported: true });
  mocks.persistDeploymentIntent.mockResolvedValue({
    connection, desiredRevision, intentId, rules: [],
  });
  mocks.get.mockResolvedValue(pending);
});

describe("rule deployment transaction", () => {
  it("persists intent before provider activation and CAS-finalizes success", async () => {
    const completed = { ...pending, deployment: { status: "deployed" } };
    mocks.put.mockResolvedValueOnce(desired).mockResolvedValueOnce(completed);
    mocks.deployRules.mockResolvedValue({
      providerState: "next", scriptHash: "a".repeat(43),
      scriptId: "script", status: "deployed",
    });
    await expect(mutateAndDeployRules(connection, operation)).resolves
      .toEqual(completed);
    expect(mocks.persistDeploymentIntent).toHaveBeenCalledWith(
      { email: "member@example.com", providerId: "stalwart-jmap" },
      desiredRevision,
      connection,
    );
    expect(mocks.deployRules).toHaveBeenCalledWith({
      expectedProviderState: "provider-state", rules: [],
    });
    expect(mocks.put).toHaveBeenLastCalledWith(expect.anything(),
      expect.objectContaining({ expectedRevision: pendingRevision,
        intentId, operation: "finalize-deployment",
        result: expect.objectContaining({ status: "deployed" }) }));
  });

  it("records a provider conflict and exposes only a sanitized API error", async () => {
    mocks.put.mockResolvedValueOnce(desired).mockResolvedValueOnce(pending);
    mocks.deployRules.mockRejectedValue(Object.assign(
      new Error("secret provider detail"), { code: "RULE_PROVIDER_CONFLICT" },
    ));
    await expect(mutateAndDeployRules(connection, operation)).rejects
      .toMatchObject({
        code: "MAIL_RULE_PROVIDER_CONFLICT",
        message: "Another provider rule script is active. It was left unchanged.",
        status: 409,
      });
    expect(mocks.put).toHaveBeenLastCalledWith(expect.anything(),
      expect.objectContaining({ result: {
        errorCode: "RULE_PROVIDER_CONFLICT", status: "conflict",
      } }));
  });

  it("preserves a trusted fail-closed ManageSieve conflict reason", async () => {
    mocks.put.mockResolvedValueOnce(desired).mockResolvedValueOnce(pending);
    mocks.deployRules.mockRejectedValue(new ManageSieveError(
      "RULE_PROVIDER_CONFLICT",
      "Rules changed at the provider. Reload before saving.",
    ));

    await expect(mutateAndDeployRules(connection, operation)).rejects
      .toMatchObject({
        code: "MAIL_RULE_PROVIDER_CONFLICT",
        message: "Rules changed at the provider. Reload before saving.",
        status: 409,
      });
  });

  it("replaces an imported book once before the normal deployment transaction", async () => {
    const completed = { ...pending, deployment: { status: "deployed" } };
    mocks.get.mockReset();
    mocks.get.mockResolvedValueOnce(desired).mockResolvedValueOnce(pending);
    mocks.put.mockResolvedValueOnce(desired).mockResolvedValueOnce(completed);
    mocks.deployRules.mockResolvedValue({
      providerState: "next", scriptHash: "a".repeat(43),
      scriptId: "script", status: "deployed",
    });
    await expect(replaceAndDeployRules(
      connection,
      [operation.definition],
    )).resolves.toEqual(completed);
    expect(mocks.put).toHaveBeenNthCalledWith(1, expect.anything(), {
      definitions: [operation.definition],
      expectedRevision: desiredRevision,
      operation: "replace-from-import",
    });
    expect(mocks.deployRules).toHaveBeenCalledOnce();
  });
});
