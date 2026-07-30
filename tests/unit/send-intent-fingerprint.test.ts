import { describe, expect, it } from "vitest";

import type { CanonicalSendIntent } from "@/server/mail/send-intent-fingerprint";
import { sendIntentFingerprint } from "@/server/mail/send-intent-fingerprint";

const intent = (): CanonicalSendIntent => ({
  attachmentIds: ["attachment-one", "attachment-two"],
  bcc: [{ email: "Hidden@Example.com", name: "Hidden Person" }],
  body: "Body with e\u0301",
  cc: [{ email: "Copy@Example.com", name: null }],
  htmlBody: null,
  inReplyTo: "provider-message-id",
  subject: "Subject",
  to: [{ email: "Primary@Example.com", name: "Primary Person" }],
});

describe("send intent fingerprint", () => {
  it("is deterministic for an exact validated provider-bound intent", () => {
    const first = intent();
    const clone = structuredClone(first);

    expect(sendIntentFingerprint(first)).toMatch(/^[0-9a-f]{64}$/u);
    expect(sendIntentFingerprint(clone)).toBe(sendIntentFingerprint(first));
  });

  it("preserves exact casing instead of normalizing addresses", () => {
    const first = intent();
    const changed = {
      ...first,
      to: [{ ...first.to[0]!, email: "primary@example.com" }],
    };

    expect(sendIntentFingerprint(changed)).not.toBe(
      sendIntentFingerprint(first),
    );
  });

  it.each(["body", "subject", "name"] as const)(
    "does not merge NFC and NFD %s values",
    (field) => {
      const first = intent();
      const nfc = "\u00e9";
      const nfd = "e\u0301";
      const changed =
        field === "name"
          ? { ...first, to: [{ ...first.to[0]!, name: nfc }] }
          : { ...first, [field]: nfc };
      const original =
        field === "name"
          ? { ...first, to: [{ ...first.to[0]!, name: nfd }] }
          : { ...first, [field]: nfd };

      expect(sendIntentFingerprint(changed)).not.toBe(
        sendIntentFingerprint(original),
      );
    },
  );

  it("binds recipient buckets/order, attachment order, and reply context", () => {
    const first = intent();
    const variants: readonly CanonicalSendIntent[] = [
      { ...first, attachmentIds: [...first.attachmentIds].reverse() },
      { ...first, bcc: first.cc, cc: first.bcc },
      { ...first, inReplyTo: "different-message-id" },
      {
        ...first,
        to: [
          { email: "Second@example.com", name: null },
          ...first.to,
        ],
      },
    ];

    for (const variant of variants) {
      expect(sendIntentFingerprint(variant)).not.toBe(
        sendIntentFingerprint(first),
      );
    }
  });

  it("binds the exact canonical HTML representation including its absence", () => {
    const plain = intent();
    const rich = {
      ...plain,
      htmlBody: "<p>Body with e\u0301</p>",
    };
    const changed = {
      ...rich,
      htmlBody: "<p><strong>Body with e\u0301</strong></p>",
    };

    expect(sendIntentFingerprint(rich)).not.toBe(
      sendIntentFingerprint(plain),
    );
    expect(sendIntentFingerprint(changed)).not.toBe(
      sendIntentFingerprint(rich),
    );
  });
});
