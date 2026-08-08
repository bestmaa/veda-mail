import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ client: {
  fetchAll: vi.fn(), mailboxOpen: vi.fn(), search: vi.fn(),
} }));
vi.mock("@/infrastructure/providers/imap-smtp/imap-client", () => ({
  withImapClient: (_config: unknown, operation: (client: unknown) => unknown) =>
    operation(mocks.client),
}));

import type { MailRule } from "@/domain/mail/rule";
import { previewImapRules } from "@/infrastructure/providers/imap-smtp/imap-rule-preview";

const config = {
  imapHost: "imap.example.com", imapPort: "993", imapSecurity: "tls",
  secret: "secret", smtpHost: "smtp.example.com", smtpMaxMessageBytes: "26214400",
  smtpPort: "465", smtpSecurity: "tls", username: "member@example.com",
} as const;
const rule = {
  actions: [{ kind: "mark-read" }], conditions: [{
    kind: "header", name: "x-tenant", operator: "is", value: "north",
  }], createdAt: "2026-08-04T00:00:00.000Z", enabled: true,
  id: "11111111-1111-4111-8111-111111111111", match: "all",
  name: "Tenant", stopProcessing: false,
  updatedAt: "2026-08-04T00:00:00.000Z",
} as const satisfies MailRule;

beforeEach(() => {
  Object.values(mocks.client).forEach((mock) => mock.mockReset());
  mocks.client.mailboxOpen.mockResolvedValue({ uidValidity: BigInt(9) });
  mocks.client.search.mockResolvedValue([1, 2]);
  mocks.client.fetchAll.mockResolvedValue([{ bodyStructure: {
    childNodes: [], disposition: "inline", part: "1", type: "text/plain",
  }, envelope: { from: [{ address: "sender@example.com" }],
    subject: "Hello", to: [{ address: "member@example.com" }] },
  source: Buffer.from("X-Tenant: north\r\n\r\nbody"),
  internalDate: new Date("2026-08-04T01:00:00.000Z"), seq: 2,
  size: 123, uid: 2 }, { bodyStructure: {
    childNodes: [], part: "1", type: "text/plain",
  }, envelope: { subject: "Older" }, source: Buffer.from("\r\nbody"),
  internalDate: new Date("2026-08-03T01:00:00.000Z"), seq: 1,
  size: 50, uid: 1 }]);
});

describe("IMAP rule preview", () => {
  it("opens INBOX read-only, reads bounded headers, and preserves newest order", async () => {
    const preview = await previewImapRules(config, { limit: 2, rules: [rule] });
    expect(mocks.client.mailboxOpen).toHaveBeenCalledWith("INBOX", { readOnly: true });
    expect(mocks.client.fetchAll.mock.calls[0]?.[1]).toMatchObject({
      source: { maxLength: 65_540 },
    });
    expect(mocks.client.fetchAll.mock.calls[0]?.[1]).not.toHaveProperty("bodyParts");
    expect(preview.map(({ subject }) => subject)).toEqual(["Hello", "Older"]);
    expect(preview[0]?.evaluation.matchedRuleIds).toEqual([rule.id]);
    expect(preview[1]?.evaluation.matchedRuleIds).toEqual([]);
  });

  it("fails closed when a requested header block is incomplete", async () => {
    mocks.client.fetchAll.mockResolvedValueOnce([{
      envelope: { subject: "Incomplete" },
      internalDate: new Date("2026-08-04T01:00:00.000Z"),
      seq: 2, size: 123,
      source: Buffer.alloc(65_540, 0x61), uid: 2,
    }]);

    await expect(previewImapRules(config, { limit: 1, rules: [rule] }))
      .rejects.toThrow("incomplete preview headers");
  });
});
