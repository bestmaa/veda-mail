import { describe, expect, it } from "vitest";

import { createAdminCapabilitySnapshot } from "@/server/organization/organization-policy.service";

const capabilities = {
  maxAttachmentBytes: 18 * 1024 * 1024,
  maxAttachmentDownloadBytes: 50 * 1024 * 1024,
  supportsAttachmentDownload: true,
  supportsDrafts: false,
  supportsPasswordChange: true,
  supportsProfileSettings: true,
  supportsPush: false,
  supportsServerSearch: true,
  supportsThreads: true,
  supportsTwoFactorAuthentication: false,
};

describe("admin capability snapshot", () => {
  it("never expands provider support and applies organization controls", () => {
    const snapshot = createAdminCapabilitySnapshot(
      { id: "imap-smtp", name: "Standard IMAP and SMTP" },
      capabilities,
      {
        memberPasswordChange: false,
        memberProfileEditing: true,
        memberTwoFactorEnrollment: false,
      },
    );

    expect(snapshot.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          effective: false,
          id: "provider-drafts",
          organizationControl: null,
          providerSupported: false,
        }),
        expect.objectContaining({
          effective: false,
          id: "member-password",
          organizationEnabled: false,
          providerSupported: true,
        }),
        expect.objectContaining({
          effective: true,
          id: "member-profile",
          organizationEnabled: true,
          providerSupported: true,
        }),
        expect.objectContaining({
          effective: false,
          id: "member-two-factor",
          organizationEnabled: false,
          providerSupported: true,
        }),
      ]),
    );
  });
});
