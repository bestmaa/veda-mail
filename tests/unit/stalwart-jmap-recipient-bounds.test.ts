import { describe, expect, it } from "vitest";

import { jmapEmailSchema } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.schema";

const email = (overrides: Record<string, unknown> = {}) => ({
  hasAttachment: false,
  id: "message-1",
  keywords: {},
  mailboxIds: { inbox: true },
  preview: "",
  receivedAt: "2026-07-30T00:00:00.000Z",
  size: 100,
  subject: "Recipient bounds",
  threadId: "thread-1",
  ...overrides,
});

const addresses = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    email: `recipient-${index}@example.com`,
    name: null,
  }));

describe("Stalwart JMAP recipient bounds", () => {
  it.each(["bcc", "cc", "from", "replyTo", "to"] as const)(
    "bounds %s at 100 addresses without rejecting the message batch",
    (field) => {
      const parsed = jmapEmailSchema.parse(
        email({ [field]: addresses(101) }),
      );

      expect(parsed[field]).toHaveLength(100);
      expect(parsed[field]?.at(-1)?.email).toBe(
        "recipient-99@example.com",
      );
    },
  );

  it("bounds sender-controlled address and summary text before mapping", () => {
    const parsed = jmapEmailSchema.parse(
      email({
        from: [{ email: "x".repeat(1_200), name: "n".repeat(5_000) }],
        preview: "p".repeat(20_000),
        subject: "s".repeat(1_200),
      }),
    );

    expect(parsed.from?.[0]?.email).toHaveLength(998);
    expect(parsed.from?.[0]?.name).toHaveLength(4_096);
    expect(parsed.preview).toHaveLength(16_384);
    expect(parsed.subject).toHaveLength(998);
  });
});
