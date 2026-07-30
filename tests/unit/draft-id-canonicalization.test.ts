import { describe, expect, it } from "vitest";

import {
  attachmentImportSchema,
  attachmentReservationSchema,
  sendMessageSchema,
} from "@/transport/http/request-schemas";

const uppercaseDraft = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
const lowercaseDraft = uppercaseDraft.toLowerCase();

describe("draft identifier canonicalization", () => {
  it("lowercases attachment reservation and import UUIDs", () => {
    expect(
      attachmentReservationSchema.parse({
        declaredMimeType: "text/plain",
        draftId: uppercaseDraft,
        fileName: "draft.txt",
        size: 1,
      }).draftId,
    ).toBe(lowercaseDraft);
    expect(
      attachmentImportSchema.parse({ draftId: uppercaseDraft }).draftId,
    ).toBe(lowercaseDraft);
  });

  it("lowercases every message draft UUID before idempotency lookup", () => {
    expect(
      sendMessageSchema.parse({
        body: "Canonical UUID",
        draftId: uppercaseDraft,
        subject: "Canonical",
        to: [{ email: "recipient@example.com", name: null }],
      }).draftId,
    ).toBe(lowercaseDraft);
  });
});
