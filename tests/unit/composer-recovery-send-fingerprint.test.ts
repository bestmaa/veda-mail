import { describe, expect, it } from "vitest";

import { id } from "@/domain/shared/brand";
import { fingerprintComposerRecoverySend } from "@/presentation/features/mail-workspace/composer-recovery-send-fingerprint";
import type { ComposerRecoverySendRequest } from "@/presentation/features/mail-workspace/composer-recovery.types";

const request = (): ComposerRecoverySendRequest => ({
  attachmentIds: [id.attachmentUpload("attachment-capability-a")],
  bcc: [],
  body: "Body",
  cc: [],
  draftId: id.draft("11111111-1111-4111-8111-111111111111"),
  subject: "Subject",
  to: [{ email: "person@example.com", name: "Person" }],
});

describe("composer recovery send fingerprint", () => {
  it("hashes the canonical request that is returned for the HTTP call", async () => {
    const first = await fingerprintComposerRecoverySend({
      ...request(),
      body: "  Body  ",
      subject: " Subject ",
    });
    const repeated = await fingerprintComposerRecoverySend(first.request);

    expect(first.request.body).toBe("Body");
    expect(first.request.subject).toBe("Subject");
    expect(first.requestFingerprint).toMatch(/^[0-9a-f]{64}$/u);
    expect(repeated.requestFingerprint).toBe(first.requestFingerprint);
  });

  it("binds upload capabilities and recipient buckets", async () => {
    const first = await fingerprintComposerRecoverySend(request());
    const changedAttachment = await fingerprintComposerRecoverySend({
      ...request(),
      attachmentIds: [id.attachmentUpload("attachment-capability-b")],
    });
    const changedRecipient = await fingerprintComposerRecoverySend({
      ...request(),
      bcc: request().to,
      to: [{ email: "other@example.com", name: null }],
    });

    expect(changedAttachment.requestFingerprint).not.toBe(
      first.requestFingerprint,
    );
    expect(changedRecipient.requestFingerprint).not.toBe(
      first.requestFingerprint,
    );
  });
});
