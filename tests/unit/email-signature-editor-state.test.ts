import { describe, expect, it } from "vitest";

import type { EmailSignature } from "@/domain/member/email-signature";
import { id } from "@/domain/shared/brand";
import {
  applyEmailSignatureRichSnapshot,
  emailSignatureEditorContent,
  emailSignatureEditorDraft,
  emailSignatureEditorIsDirty,
  emailSignatureEditorIsValid,
  emptyEmailSignatureEditorDraft,
} from "@/presentation/features/mail-workspace/email-signature-editor-state";

const richSignature = (): EmailSignature => ({
  body: "Ada Lovelace",
  createdAt: "2026-07-31T00:00:00.000Z",
  htmlBody: "<p><strong>Ada Lovelace</strong></p>",
  id: id.signature("11111111-1111-4111-8111-111111111111"),
  name: "Work",
  updatedAt: "2026-07-31T00:00:00.000Z",
  version: 1,
});

describe("email signature editor state", () => {
  it("starts as an invalid, clean new plain signature", () => {
    const draft = emptyEmailSignatureEditorDraft();

    expect(emailSignatureEditorIsValid(draft)).toBe(false);
    expect(emailSignatureEditorIsDirty(draft, null)).toBe(false);
    expect(emailSignatureEditorContent(draft)).toEqual({
      body: "",
      mode: "plain",
    });
  });

  it("maps canonical rich signatures into rich update content", () => {
    const source = richSignature();
    const draft = emailSignatureEditorDraft(source);

    expect(draft.mode).toBe("rich");
    expect(emailSignatureEditorIsValid(draft)).toBe(true);
    expect(emailSignatureEditorIsDirty(draft, source)).toBe(false);
    expect(emailSignatureEditorContent(draft)).toEqual({
      htmlBody: source.htmlBody,
      mode: "rich",
    });
  });

  it("normalizes the first Lexical bridge snapshot without false dirty state", () => {
    const source = richSignature();
    const mounted = applyEmailSignatureRichSnapshot(
      emailSignatureEditorDraft(source),
      source,
      {
        html: "<p><b>Ada Lovelace</b></p>",
        text: "Ada Lovelace",
      },
      true,
    );

    expect(emailSignatureEditorIsDirty(mounted.draft, mounted.source)).toBe(
      false,
    );
    const edited = applyEmailSignatureRichSnapshot(
      mounted.draft,
      mounted.source,
      {
        html: "<p><b>Ada Lovelace</b> · Engineering</p>",
        text: "Ada Lovelace · Engineering",
      },
      false,
    );
    expect(emailSignatureEditorIsDirty(edited.draft, edited.source)).toBe(true);
  });
});
