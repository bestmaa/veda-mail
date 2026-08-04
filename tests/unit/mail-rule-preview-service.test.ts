import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  previewRules: vi.fn(),
  resolveGateway: vi.fn(),
}));
vi.mock("@/server/mail/gateway-cache", () => ({
  resolveGateway: mocks.resolveGateway,
}));

import type { MailRule } from "@/domain/mail/rule";
import { id } from "@/domain/shared/brand";
import { previewMailRules } from "@/server/rules/rule-preview.service";

const connection = {
  config: {}, createdAt: "2026-08-04T00:00:00.000Z", displayName: "Mail",
  id: id.connection("preview-service"), providerId: id.provider("mock"),
};
const baseRule = {
  actions: [{ kind: "star" }], createdAt: "2026-08-04T00:00:00.000Z",
  enabled: true, id: "11111111-1111-4111-8111-111111111111",
  match: "all", name: "Preview", stopProcessing: false,
  updatedAt: "2026-08-04T00:00:00.000Z",
} as const;

beforeEach(() => {
  mocks.previewRules.mockReset().mockResolvedValue([]);
  mocks.resolveGateway.mockReset().mockResolvedValue({
    previewRules: mocks.previewRules,
  });
});

describe("mail rule preview service", () => {
  it("never approximates the SMTP envelope recipient", async () => {
    const rules = [{ ...baseRule, conditions: [{
      field: "recipient", kind: "address", operator: "is",
      value: "member@example.com",
    }] }] as readonly MailRule[];
    await expect(previewMailRules(connection, { limit: 10, rules }))
      .rejects.toMatchObject({ code: "MAIL_RULE_PREVIEW_CONDITION_UNSUPPORTED" });
    expect(mocks.resolveGateway).not.toHaveBeenCalled();
  });

  it("bounds unique custom header reads", async () => {
    const rules = [{ ...baseRule, conditions: Array.from({ length: 9 }, (_, index) => ({
      kind: "header" as const, name: `x-preview-${index}`,
      operator: "exists" as const,
    })) }] as readonly MailRule[];
    await expect(previewMailRules(connection, { limit: 10, rules }))
      .rejects.toMatchObject({ code: "MAIL_RULE_PREVIEW_HEADER_LIMIT" });
    expect(mocks.resolveGateway).not.toHaveBeenCalled();
  });

  it("delegates safe facts to the provider reader", async () => {
    const rules = [{ ...baseRule, conditions: [{
      kind: "subject", operator: "contains", value: "invoice",
    }] }] as readonly MailRule[];
    await expect(previewMailRules(connection, { limit: 10, rules }))
      .resolves.toEqual([]);
    expect(mocks.previewRules).toHaveBeenCalledWith({ limit: 10, rules });
  });
});
