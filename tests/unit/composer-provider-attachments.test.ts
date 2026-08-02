import { describe, expect, it } from "vitest";

import type { DraftDetail } from "@/domain/mail/draft";
import { id } from "@/domain/shared/brand";
import {
  providerComposerAttachments,
  reconcileComposerProviderAttachments,
} from "@/presentation/features/mail-workspace/hooks/composer-provider-attachments";

const metadata = (value: string) => ({
  disposition: "attachment" as const,
  id: id.attachment(value),
  mimeType: "text/plain",
  name: `${value}.txt`,
  size: 4,
});
const draft = (
  attachments: NonNullable<DraftDetail["attachments"]>,
): DraftDetail => ({
  attachments,
  composeId: id.draft("11111111-1111-4111-8111-111111111111"),
  content: { bcc: [], body: "", cc: [], subject: "", to: [] },
  hasAttachments: Boolean(attachments?.length),
  hasTruncatedContent: false,
  hasUncertainSubmission: false,
  id: id.providerDraft("draft"),
  revision: "revision",
  updatedAt: "2026-08-02T00:00:00.000Z",
});

describe("composer provider attachment reconciliation", () => {
  it("replaces submitted items while preserving a newer in-flight upload", () => {
    const oldProvider = metadata("old-provider");
    const current = [
      ...providerComposerAttachments(draft([oldProvider])),
      { error: null, key: "submitted", name: "submitted.txt", size: 4,
        state: "ready" as const, upload: { expiresAt: "2099-01-01T00:00:00.000Z",
          id: id.attachmentUpload("submitted-upload"), mimeType: "text/plain",
          name: "submitted.txt", size: 4 } },
      { error: null, key: "newer", name: "newer.txt", size: 4,
        state: "ready" as const, upload: { expiresAt: "2099-01-01T00:00:00.000Z",
          id: id.attachmentUpload("newer-upload"), mimeType: "text/plain",
          name: "newer.txt", size: 4 } },
    ];
    const result = reconcileComposerProviderAttachments(
      current,
      draft([metadata("retained-new"), metadata("uploaded-new")]),
      ["submitted-upload"],
      ["old-provider"],
    );

    expect(result.attachments.map(({ key }) => key)).toEqual([
      "retained-new", "uploaded-new", "newer",
    ]);
    expect(result.replacedKeys).toEqual(["old-provider", "submitted"]);
  });
});
