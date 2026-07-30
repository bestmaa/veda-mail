import type { SignatureId } from "@/domain/shared/brand";

export const MAX_EMAIL_SIGNATURES = 20;
export const MAX_EMAIL_SIGNATURE_NAME_CHARACTERS = 80;
export const MAX_EMAIL_SIGNATURE_NAME_UTF8_BYTES = 256;
export const MAX_EMAIL_SIGNATURE_CONTENT_CHARACTERS = 16 * 1024;
export const MAX_EMAIL_SIGNATURE_CONTENT_UTF8_BYTES = 16 * 1024;
export const MAX_EMAIL_SIGNATURE_COMBINED_CHARACTERS = 32 * 1024;
export const MAX_EMAIL_SIGNATURE_COMBINED_UTF8_BYTES = 32 * 1024;
export const MAX_EMAIL_SIGNATURE_HTML_DEPTH = 16;
export const MAX_EMAIL_SIGNATURE_HTML_NODES = 256;
export const MAX_EMAIL_SIGNATURE_REQUEST_BYTES = 128 * 1024;

export interface EmailSignature {
  readonly body: string;
  readonly createdAt: string;
  readonly htmlBody?: string;
  readonly id: SignatureId;
  readonly name: string;
  readonly updatedAt: string;
  readonly version: 1;
}

export interface EmailSignatureDefaults {
  readonly newMessageId: SignatureId | null;
  readonly replyForwardId: SignatureId | null;
}

export interface EmailSignatureBook {
  readonly createdAt: string | null;
  readonly defaults: EmailSignatureDefaults;
  readonly revision: string | null;
  readonly signatures: readonly EmailSignature[];
  readonly updatedAt: string | null;
  readonly version: 1;
}

export interface EmailSignatureOwner {
  readonly email: string;
  readonly providerId: string;
}

export type EmailSignatureCanonicalContent = Pick<
  EmailSignature,
  "body" | "htmlBody"
>;

export type EmailSignatureContentInput =
  | { readonly body: string; readonly mode: "plain" }
  | { readonly htmlBody: string; readonly mode: "rich" };

export type EmailSignaturePutOperation =
  | {
      readonly content: EmailSignatureContentInput;
      readonly expectedRevision: string | null;
      readonly name: string;
      readonly operation: "create";
    }
  | {
      readonly content: EmailSignatureContentInput;
      readonly expectedRevision: string | null;
      readonly name: string;
      readonly operation: "update";
      readonly signatureId: SignatureId;
    }
  | {
      readonly expectedRevision: string | null;
      readonly operation: "delete";
      readonly signatureId: SignatureId;
    }
  | {
      readonly expectedRevision: string | null;
      readonly newMessageId: SignatureId | null;
      readonly operation: "set-defaults";
      readonly replyForwardId: SignatureId | null;
    };
