import { describe, expect, it } from "vitest";

import { id } from "@/domain/shared/brand";
import { parseComposerRecoveryJournal } from "@/presentation/features/mail-workspace/composer-recovery-schema";
import {
  armComposerRecoveryDiscard,
  armComposerRecoverySend,
  composerTerminalRecoveryDirective,
  explicitComposerDiscardReplay,
  markComposerRecoverySendUncertain,
} from "@/presentation/features/mail-workspace/composer-recovery-transitions";
import type { ComposerRecoveryJournal } from "@/presentation/features/mail-workspace/composer-recovery.types";
import { recoveryJournal } from "./composer-recovery-fixture";

const providerDraftId = id.providerDraft("provider-draft-a");
const intentId = "33333333-3333-4333-8333-333333333333";
const issuedAt = "2026-07-31T12:05:00.000Z";
const requestFingerprint = "a".repeat(64);

const withoutPending = (): ComposerRecoveryJournal => {
  const { pendingSave, ...journal } = recoveryJournal();
  void pendingSave;
  return journal;
};

const acknowledgedJournal = (): ComposerRecoveryJournal => ({
  ...withoutPending(),
  acknowledged: {
    generation: 1,
    providerDraftId,
    revision: "revision-a",
  },
});

describe("composer terminal recovery", () => {
  it("arms a fingerprint-only send intent and exposes only check-Sent", () => {
    const armed = armComposerRecoverySend(withoutPending(), {
      intentId, issuedAt, requestFingerprint,
    });

    expect(armed?.terminalIntent).toMatchObject({
      composeId: recoveryJournal().composeId,
      generation: 2,
      intentId,
      kind: "send",
      requestFingerprint,
      state: "armed",
    });
    expect(armed?.terminalIntent).not.toHaveProperty("request");
    const directive = composerTerminalRecoveryDirective(armed);
    expect(directive).toEqual({
      action: "check-sent", intentId, outcome: "uncertain",
    });
    expect(directive).not.toHaveProperty("request");
    expect(parseComposerRecoveryJournal(structuredClone(armed))).not.toBeNull();
  });

  it("marks an ambiguous send uncertain without changing its fingerprint", () => {
    const armed = armComposerRecoverySend(withoutPending(), {
      intentId, issuedAt, requestFingerprint,
    });
    const uncertain = markComposerRecoverySendUncertain(
      armed,
      intentId,
      "2026-07-31T12:06:00.000Z",
    );

    expect(uncertain?.terminalIntent).toMatchObject({
      kind: "send", requestFingerprint, state: "uncertain",
    });
    expect(uncertain?.storageRevision).toBe((armed?.storageRevision ?? 0) + 1);
    expect(markComposerRecoverySendUncertain(uncertain, intentId, issuedAt))
      .toBeNull();
  });

  it("never arms a terminal action beside an in-flight draft save", () => {
    expect(armComposerRecoverySend(recoveryJournal(), {
      intentId, issuedAt, requestFingerprint,
    })).toBeNull();

    const armed = armComposerRecoverySend(withoutPending(), {
      intentId, issuedAt, requestFingerprint,
    });
    expect(parseComposerRecoveryJournal({
      ...armed,
      pendingSave: recoveryJournal().pendingSave,
    })).toBeNull();
  });

  it("binds terminal sends to the exact compose, generation, owner, and draft", () => {
    expect(armComposerRecoverySend(acknowledgedJournal(), {
      intentId, issuedAt, requestFingerprint,
    })).toBeNull();
    expect(armComposerRecoverySend(withoutPending(), {
      expectedDraftRevision: "revision-a", intentId, issuedAt,
      providerDraftId, requestFingerprint,
    })).toBeNull();
    const armed = armComposerRecoverySend(acknowledgedJournal(), {
      expectedDraftRevision: "revision-a", intentId, issuedAt,
      providerDraftId, requestFingerprint,
    });
    expect(armed).not.toBeNull();
    if (!armed?.terminalIntent) throw new Error("Expected terminal intent.");

    for (const terminalIntent of [
      { ...armed.terminalIntent, composeId: id.draft("44444444-4444-4444-8444-444444444444") },
      { ...armed.terminalIntent, generation: 1 },
      { ...armed.terminalIntent, owner: { ...armed.terminalIntent.owner, sessionScope: "scope-b" } },
      armed.terminalIntent.kind === "send" ? {
        ...armed.terminalIntent,
        expectedDraftRevision: "revision-b",
      } : armed.terminalIntent,
    ]) {
      expect(parseComposerRecoveryJournal({ ...armed, terminalIntent })).toBeNull();
    }
  });

  it("requires explicit confirmation to replay the exact discard", () => {
    const armed = armComposerRecoveryDiscard(acknowledgedJournal(), {
      expectedRevision: "revision-a",
      intentId,
      issuedAt,
      providerDraftId,
    });

    expect(composerTerminalRecoveryDirective(armed)).toEqual({
      action: "confirm-discard-replay",
      expectedRevision: "revision-a",
      intentId,
      providerDraftId,
    });
    expect(explicitComposerDiscardReplay(armed, "wrong-intent")).toBeNull();
    expect(explicitComposerDiscardReplay(armed, intentId)).toEqual({
      expectedRevision: "revision-a", providerDraftId,
    });
    expect(armComposerRecoveryDiscard(acknowledgedJournal(), {
      expectedRevision: "revision-b", intentId, issuedAt, providerDraftId,
    })).toBeNull();
  });

  it("rejects malformed fingerprints and time-invalid terminal intents", () => {
    const armed = armComposerRecoverySend(withoutPending(), {
      intentId, issuedAt, requestFingerprint,
    });
    if (armed?.terminalIntent?.kind !== "send") {
      throw new Error("Expected send intent.");
    }
    expect(parseComposerRecoveryJournal({
      ...armed,
      terminalIntent: { ...armed.terminalIntent, requestFingerprint: "not-a-digest" },
    })).toBeNull();
    expect(parseComposerRecoveryJournal({
      ...armed,
      terminalIntent: { ...armed.terminalIntent, request: { body: "secret" } },
    })).toBeNull();
    expect(() => armComposerRecoverySend(withoutPending(), {
      intentId,
      issuedAt: "2026-08-01T00:01:00.000Z",
      requestFingerprint,
    })).toThrow();
  });
});
