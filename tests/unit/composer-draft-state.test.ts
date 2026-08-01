import { describe, expect, it } from "vitest";

import {
  composerDraftAvailability,
  completeDraftSave,
  isAmbiguousDraftSaveFailure,
  providerDraftEditBlock,
  UNCERTAIN_PROVIDER_DRAFT_MESSAGE,
} from "@/presentation/features/mail-workspace/composer-draft-state";
import { id } from "@/domain/shared/brand";
import { ApiClientError } from "@/transport/client/api-request";

describe("composer draft save completion", () => {
  it("marks the exact content generation saved", () => {
    expect(completeDraftSave(3, 3)).toEqual({
      isDirty: false,
      phase: "saved",
    });
  });

  it("keeps newer edits unsaved after an older save response", () => {
    expect(completeDraftSave(3, 4)).toEqual({
      isDirty: true,
      phase: "unsaved",
    });
  });
});

describe("composer draft failure certainty", () => {
  it("journals network and server failures for exact reconciliation", () => {
    expect(isAmbiguousDraftSaveFailure(new TypeError("network"))).toBe(true);
    expect(isAmbiguousDraftSaveFailure(
      new ApiClientError("Timed out", 408, "REQUEST_TIMEOUT"),
    )).toBe(true);
    expect(isAmbiguousDraftSaveFailure(
      new ApiClientError("Provider failed", 503, "MAIL_PROVIDER_FAILURE"),
    )).toBe(true);
  });

  it("does not replay definitive validation, throttling, or conflict responses", () => {
    for (const status of [400, 409, 429]) {
      expect(isAmbiguousDraftSaveFailure(
        new ApiClientError("Definitive", status, "MAIL_DRAFT_FAILURE"),
      )).toBe(false);
    }
  });
});

describe("composer provider draft availability", () => {
  const saved = {
    composeId: id.draft("compose-a"),
    content: { bcc: [], body: "Body", cc: [], subject: "Subject", to: [] },
    hasAttachments: false,
    hasTruncatedContent: false,
    hasUncertainSubmission: false,
    id: id.providerDraft("provider-a"),
    revision: "revision-a",
    updatedAt: "2026-07-31T10:00:00.000Z",
  };

  it("requires a clean current revision before provider-backed send", () => {
    const availability = composerDraftAvailability({
      hasLocalAttachments: false,
      isDirty: true,
      providerDraftRequested: true,
      requiresRecovery: false,
      saved,
      terminalRecovery: null,
    });
    expect(availability.canSend).toBe(false);
    expect(availability.sendBlockedMessage).toContain("Save changes");
  });

  it("requires manual adoption for an imported provider draft", () => {
    const availability = composerDraftAvailability({
      hasLocalAttachments: false,
      isDirty: false,
      providerDraftRequested: true,
      requiresRecovery: false,
      saved: { ...saved, composeId: null },
      terminalRecovery: null,
    });
    expect(availability.canSave).toBe(true);
    expect(availability.canSend).toBe(false);
    expect(availability.sendBlockedMessage).toContain("imported");
  });

  it("blocks every destructive action while an existing handle needs recovery", () => {
    const availability = composerDraftAvailability({
      hasLocalAttachments: false,
      isDirty: true,
      providerDraftRequested: true,
      requiresRecovery: true,
      saved,
      terminalRecovery: null,
    });
    expect(availability.canDiscard).toBe(false);
    expect(availability.canSave).toBe(false);
    expect(availability.canSend).toBe(false);
    expect(availability.sendBlockedMessage).toContain("Recover");
  });

  it("cannot claim to discard a provider draft that did not load", () => {
    const availability = composerDraftAvailability({
      hasLocalAttachments: false,
      isDirty: false,
      providerDraftRequested: true,
      requiresRecovery: false,
      saved: null,
      terminalRecovery: null,
    });
    expect(availability.canDiscard).toBe(false);
  });

  it.each(["send", "discard"] as const)(
    "keeps a terminal %s recovery copy read-only until explicit resume",
    (terminalRecovery) => {
      const availability = composerDraftAvailability({
        hasLocalAttachments: false,
        isDirty: true,
        providerDraftRequested: false,
        requiresRecovery: true,
        saved: null,
        terminalRecovery,
      });

      expect(availability).toMatchObject({
        canDiscard: false,
        canEdit: false,
        canSave: false,
        canSend: false,
      });
    },
  );

  it("locks an uncertain submission while preserving explicit discard", () => {
    const uncertain = {
      ...saved,
      hasAttachments: true,
      hasTruncatedContent: true,
      hasUncertainSubmission: true,
    };
    const availability = composerDraftAvailability({
      hasLocalAttachments: false,
      isDirty: false,
      providerDraftRequested: true,
      requiresRecovery: false,
      saved: uncertain,
      terminalRecovery: null,
    });

    expect(providerDraftEditBlock(uncertain)).toBe(
      UNCERTAIN_PROVIDER_DRAFT_MESSAGE,
    );
    expect(availability).toMatchObject({
      canDiscard: true,
      canEdit: false,
      canSave: false,
      canSend: false,
    });
  });
});
