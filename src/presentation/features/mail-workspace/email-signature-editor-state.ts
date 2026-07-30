import type {
  EmailSignature,
  EmailSignatureContentInput,
} from "@/domain/member/email-signature";
import type { SignatureId } from "@/domain/shared/brand";

export interface EmailSignatureEditorDraft {
  readonly body: string;
  readonly htmlBody: string;
  readonly mode: "plain" | "rich";
  readonly name: string;
  readonly richText: string;
  readonly signatureId: SignatureId | null;
}

export const emptyEmailSignatureEditorDraft =
  (): EmailSignatureEditorDraft => ({
    body: "",
    htmlBody: "",
    mode: "plain",
    name: "",
    richText: "",
    signatureId: null,
  });

export const emailSignatureEditorDraft = (
  signature: EmailSignature,
): EmailSignatureEditorDraft => ({
  body: signature.body,
  htmlBody: signature.htmlBody ?? "",
  mode: signature.htmlBody ? "rich" : "plain",
  name: signature.name,
  richText: signature.body,
  signatureId: signature.id,
});

export const emailSignatureEditorContent = (
  draft: EmailSignatureEditorDraft,
): EmailSignatureContentInput =>
  draft.mode === "plain"
    ? { body: draft.body, mode: "plain" }
    : { htmlBody: draft.htmlBody, mode: "rich" };

export const applyEmailSignatureRichSnapshot = (
  draft: EmailSignatureEditorDraft,
  source: EmailSignature | null,
  snapshot: { readonly html: string; readonly text: string },
  normalizeBaseline: boolean,
) => ({
  draft: {
    ...draft,
    htmlBody: snapshot.html,
    richText: snapshot.text,
  },
  source:
    normalizeBaseline && source
      ? {
          ...source,
          body: snapshot.text,
          htmlBody: snapshot.html,
        }
      : source,
});

export const emailSignatureEditorIsValid = (
  draft: EmailSignatureEditorDraft,
): boolean =>
  Boolean(
    draft.name.trim() &&
      (draft.mode === "plain"
        ? draft.body.trim()
        : draft.htmlBody.trim() && draft.richText.trim()),
  );

export const emailSignatureEditorIsDirty = (
  draft: EmailSignatureEditorDraft,
  source: EmailSignature | null,
): boolean => {
  if (!source) {
    return Boolean(
      draft.name ||
        draft.body ||
        draft.htmlBody ||
        draft.mode !== "plain",
    );
  }
  const sourceMode = source.htmlBody ? "rich" : "plain";
  return (
    draft.name !== source.name ||
    draft.mode !== sourceMode ||
    (draft.mode === "plain"
      ? draft.body !== source.body
      : draft.htmlBody !== (source.htmlBody ?? ""))
  );
};
