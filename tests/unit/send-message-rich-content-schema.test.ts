import { describe, expect, it } from "vitest";

import { sendMessageSchema } from "@/transport/http/request-schemas";

const message = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  body: "Plain fallback",
  draftId: "11111111-1111-4111-8111-111111111111",
  subject: "Rich schema",
  to: [{ email: "to@example.com", name: null }],
  ...overrides,
});

describe("rich send message validation", () => {
  it("keeps HTML optional and retains an exact bounded rich fragment", () => {
    expect(sendMessageSchema.parse(message())).not.toHaveProperty("htmlBody");
    expect(
      sendMessageSchema.parse(
        message({ htmlBody: "<p><strong>Rich</strong></p>" }),
      ),
    ).toMatchObject({
      body: "Plain fallback",
      htmlBody: "<p><strong>Rich</strong></p>",
    });
  });

  it.each([
    ["plain body", { body: "a".repeat(256_001) }],
    ["rich body", { htmlBody: "a".repeat(256_001) }],
  ])("rejects raw code-unit overflow in the %s", (_label, overrides) => {
    expect(() => sendMessageSchema.parse(message(overrides))).toThrow(
      "cannot exceed 256,000 characters",
    );
  });

  it.each([
    ["plain body", { body: "😀".repeat(64_001) }],
    ["rich body", { htmlBody: "😀".repeat(64_001) }],
  ])("rejects raw UTF-8 byte overflow in the %s", (_label, overrides) => {
    expect(() => sendMessageSchema.parse(message(overrides))).toThrow(
      "cannot exceed 256,000 UTF-8 bytes",
    );
  });

  it.each([
    ["plain NUL", { body: "safe\u0000unsafe" }],
    ["rich C1", { htmlBody: "<p>safe\u0085unsafe</p>" }],
    ["rich bidi", { htmlBody: "<p>safe\u202eunsafe</p>" }],
    ["plain surrogate", { body: "safe\ud800unsafe" }],
    ["rich surrogate", { htmlBody: "<p>safe\udc00unsafe</p>" }],
  ])("rejects invalid raw content: %s", (_label, overrides) => {
    expect(() => sendMessageSchema.parse(message(overrides))).toThrow();
  });

  it("keeps the plain fallback mandatory for backward compatibility", () => {
    expect(() =>
      sendMessageSchema.parse(
        message({
          body: " \n ",
          htmlBody: "<p>Readable rich body</p>",
        }),
      ),
    ).toThrow("Message body cannot be blank");
  });
});
