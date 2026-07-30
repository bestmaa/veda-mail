import { describe, expect, it } from "vitest";

import {
  formatRejectedRecipients,
  MAX_PARTIAL_DELIVERY_RECIPIENT_LENGTH,
  MAX_PARTIAL_DELIVERY_RECIPIENTS,
} from "@/presentation/features/mail-workspace/partial-delivery-notice";

describe("partial delivery recipient formatting", () => {
  it.each([undefined, null, "not-an-array", { 0: "fake@example.com" }])(
    "fails malformed recipient collections closed and empty",
    (value) => {
      expect(formatRejectedRecipients(value)).toEqual([]);
    },
  );

  it("normalizes and deduplicates only rejected recipients", () => {
    expect(
      formatRejectedRecipients([
        "  first@example.com  ",
        "FIRST@example.com",
        "second@example.com\n",
        "",
      ]),
    ).toEqual(["first@example.com", "second@example.com"]);
  });

  it("bounds provider-controlled count and display length", () => {
    const longRecipient = `${"x".repeat(
      MAX_PARTIAL_DELIVERY_RECIPIENT_LENGTH + 20,
    )}@example.com`;
    const recipients = Array.from(
      { length: MAX_PARTIAL_DELIVERY_RECIPIENTS + 10 },
      (_, index) => `${index}@example.com`,
    );
    const formatted = formatRejectedRecipients([
      longRecipient,
      ...recipients,
    ]);

    expect(formatted).toHaveLength(MAX_PARTIAL_DELIVERY_RECIPIENTS);
    expect(formatted[0]).toHaveLength(
      MAX_PARTIAL_DELIVERY_RECIPIENT_LENGTH,
    );
    expect(formatted[0]?.endsWith("…")).toBe(true);
    expect(formatted).not.toContain(
      `${MAX_PARTIAL_DELIVERY_RECIPIENTS}@example.com`,
    );
  });
});
