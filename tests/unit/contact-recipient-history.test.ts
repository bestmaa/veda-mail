import type { MailAddress, SendReceipt } from "@/domain/mail/mail";
import { id } from "@/domain/shared/brand";
import { confirmedRecentRecipients } from "@/server/contacts/contact-recipient-history";
import { describe, expect, it } from "vitest";

const address = (email: string, name: string | null = null): MailAddress => ({
  email,
  name,
});

const receipt = (
  deliveryStatus: SendReceipt["deliveryStatus"],
  rejectedRecipients: readonly string[] = [],
): SendReceipt => ({
  deliveryStatus,
  id: id.message("sent-1"),
  rejectedRecipients,
  submittedAt: "2026-08-04T00:00:00.000Z",
});

const input = {
  bcc: [address("hidden@example.com", "Hidden")],
  cc: [address("copy@example.com")],
  to: [address("Person@Example.com", " Person ")],
};

describe("confirmed recent recipients", () => {
  it("records every unique recipient after accepted delivery", () => {
    expect(confirmedRecentRecipients(input, receipt("accepted"))).toEqual([
      { email: "Person@Example.com", name: "Person" },
      { email: "copy@example.com", name: null },
      { email: "hidden@example.com", name: "Hidden" },
    ]);
  });

  it("excludes canonically rejected recipients after partial delivery", () => {
    expect(
      confirmedRecentRecipients(
        input,
        receipt("partial", ["person@example.com", "HIDDEN@example.com"]),
      ),
    ).toEqual([{ email: "copy@example.com", name: null }]);
  });

  it("records nothing when delivery is uncertain", () => {
    expect(confirmedRecentRecipients(input, receipt("uncertain"))).toEqual([]);
  });

  it("deduplicates across To, Cc, and Bcc without exposing bucket metadata", () => {
    expect(
      confirmedRecentRecipients(
        {
          bcc: [address("same@example.com", "Last")],
          cc: [address("SAME@example.com", "Second")],
          to: [address("same@example.com", "First")],
        },
        receipt("accepted"),
      ),
    ).toEqual([{ email: "same@example.com", name: "First" }]);
  });
});
