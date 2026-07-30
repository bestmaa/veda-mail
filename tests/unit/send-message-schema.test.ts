import { describe, expect, it } from "vitest";

import { sendMessageSchema } from "@/transport/http/request-schemas";

const recipient = (email: string, name: string | null = null) => ({
  email,
  name,
});

const message = (overrides: Record<string, unknown> = {}) => ({
  body: "Hello",
  draftId: "11111111-1111-4111-8111-111111111111",
  subject: "Greetings",
  to: [recipient("to@example.com")],
  ...overrides,
});

describe("send message validation", () => {
  it("normalizes addresses, names, body, and subject", () => {
    expect(
      sendMessageSchema.parse(
        message({
          body: "  Hello  ",
          subject: "  Greetings  ",
          to: [recipient("  Person@Example.com  ", "  Person  ")],
        }),
      ),
    ).toEqual({
      attachmentIds: [],
      bcc: [],
      body: "Hello",
      cc: [],
      draftId: "11111111-1111-4111-8111-111111111111",
      subject: "Greetings",
      to: [recipient("Person@Example.com", "Person")],
    });

    expect(
      sendMessageSchema.parse(
        message({ to: [recipient("to@example.com", "   ")] }),
      ).to,
    ).toEqual([recipient("to@example.com")]);
  });

  it("rejects unknown payload and address properties", () => {
    expect(() =>
      sendMessageSchema.parse(message({ unexpected: true })),
    ).toThrow("Unrecognized key");
    expect(() =>
      sendMessageSchema.parse({
        ...message(),
        to: [{ email: "to@example.com", name: null, role: "admin" }],
      }),
    ).toThrow("Unrecognized key");
  });

  it("validates email addresses and their maximum length", () => {
    expect(() =>
      sendMessageSchema.parse(message({ to: [recipient("not-an-email")] })),
    ).toThrow("Enter a valid email address");
    expect(() =>
      sendMessageSchema.parse(
        message({ to: [recipient(`${"a".repeat(244)}@example.com`)] }),
      ),
    ).toThrow("Email addresses cannot exceed 254 characters");
  });

  it("limits normalized recipient names to 200 characters", () => {
    expect(() =>
      sendMessageSchema.parse(
        message({
          to: [recipient("to@example.com", "a".repeat(201))],
        }),
      ),
    ).toThrow("Recipient names cannot exceed 200 characters");
  });

  it("limits each recipient field to 100 addresses", () => {
    const addresses = Array.from({ length: 101 }, (_, index) =>
      recipient(`person-${index}@example.com`),
    );
    expect(() => sendMessageSchema.parse(message({ to: addresses }))).toThrow(
      "Each recipient field can contain at most 100 addresses",
    );
  });

  it("limits the combined input to 100 recipients", () => {
    const to = Array.from({ length: 50 }, (_, index) =>
      recipient(`to-${index}@example.com`),
    );
    const cc = Array.from({ length: 50 }, (_, index) =>
      recipient(`cc-${index}@example.com`),
    );
    expect(() =>
      sendMessageSchema.parse(
        message({
          bcc: [recipient("extra@example.com")],
          cc,
          to,
        }),
      ),
    ).toThrow(
      "A message can have at most 100 recipients across To, CC, and BCC",
    );
  });

  it("deduplicates case-insensitively in To, CC, BCC order", () => {
    const parsed = sendMessageSchema.parse(
      message({
        bcc: [
          recipient("SECOND@example.com", "Duplicate"),
          recipient("third@example.com", "Third"),
        ],
        cc: [
          recipient("person@example.com", "Duplicate"),
          recipient("second@example.com", "Second"),
        ],
        to: [
          recipient("Person@Example.com", "First"),
          recipient("PERSON@example.com", "Duplicate"),
        ],
      }),
    );

    expect(parsed.to).toEqual([recipient("Person@Example.com", "First")]);
    expect(parsed.cc).toEqual([recipient("second@example.com", "Second")]);
    expect(parsed.bcc).toEqual([recipient("third@example.com", "Third")]);
  });

  it("accepts CC-only and BCC-only messages", () => {
    expect(
      sendMessageSchema.parse(
        message({
          cc: [recipient("cc@example.com")],
          to: [],
        }),
      ).cc,
    ).toEqual([recipient("cc@example.com")]);
    expect(
      sendMessageSchema.parse(
        message({
          bcc: [recipient("hidden@example.com")],
          to: [],
        }),
      ).bcc,
    ).toEqual([recipient("hidden@example.com")]);
  });

  it("requires at least one recipient across To, CC, and BCC", () => {
    expect(() =>
      sendMessageSchema.parse(
        message({
          bcc: [],
          cc: [],
          to: [],
        }),
      ),
    ).toThrow("At least one recipient is required");
  });

  it("requires a valid draft and unique attachment identifiers", () => {
    const attachmentId = "A".repeat(32);
    const draftId = crypto.randomUUID();
    expect(
      sendMessageSchema.parse(
        message({ attachmentIds: [attachmentId], draftId }),
      ),
    ).toMatchObject({ attachmentIds: [attachmentId], draftId });
    expect(() =>
      sendMessageSchema.parse(message({ draftId: undefined })),
    ).toThrow();
    expect(() =>
      sendMessageSchema.parse(message({ draftId: "not-a-uuid" })),
    ).toThrow("The message draft identifier is invalid");
    expect(() =>
      sendMessageSchema.parse(
        message({
          attachmentIds: [attachmentId, attachmentId],
          draftId,
        }),
      ),
    ).toThrow("Attachment identifiers must be unique");
  });

  it("rejects control characters in outbound header fields", () => {
    expect(() =>
      sendMessageSchema.parse(
        message({
          to: [recipient("to@example.com", "Person\r\nBcc: victim")],
        }),
      ),
    ).toThrow("Recipient names cannot contain control characters");
    expect(() =>
      sendMessageSchema.parse(message({ subject: "Hello\r\nBcc: victim" })),
    ).toThrow("Subject cannot contain control characters");
    expect(() =>
      sendMessageSchema.parse(message({ inReplyTo: "source\r\nBcc: victim" })),
    ).toThrow("Reply message identifiers cannot contain control characters");
    expect(() =>
      sendMessageSchema.parse(message({ subject: "Hello\u0085Bcc: victim" })),
    ).toThrow("Subject cannot contain control characters");
  });

  it("rejects blank or oversized bodies and oversized subjects", () => {
    expect(() => sendMessageSchema.parse(message({ body: " \n " }))).toThrow(
      "Message body cannot be blank",
    );
    expect(() =>
      sendMessageSchema.parse(message({ body: "a".repeat(256_001) })),
    ).toThrow("Message body cannot exceed 256,000 characters");
    expect(() =>
      sendMessageSchema.parse(message({ subject: "a".repeat(999) })),
    ).toThrow("Subject cannot exceed 998 characters");
  });
});
