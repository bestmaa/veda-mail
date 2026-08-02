import type { TemplateId } from "@/domain/shared/brand";

export const MAX_EMAIL_TEMPLATES = 50;
export const MAX_EMAIL_TEMPLATE_NAME_CHARACTERS = 80;
export const MAX_EMAIL_TEMPLATE_NAME_UTF8_BYTES = 256;
export const MAX_EMAIL_TEMPLATE_SUBJECT_CHARACTERS = 998;
export const MAX_EMAIL_TEMPLATE_SUBJECT_UTF8_BYTES = 4 * 1024;
export const MAX_EMAIL_TEMPLATE_CONTENT_CHARACTERS = 64 * 1024;
export const MAX_EMAIL_TEMPLATE_CONTENT_UTF8_BYTES = 64 * 1024;
export const MAX_EMAIL_TEMPLATE_COMBINED_CHARACTERS = 128 * 1024;
export const MAX_EMAIL_TEMPLATE_COMBINED_UTF8_BYTES = 128 * 1024;
export const MAX_EMAIL_TEMPLATE_BOOK_UTF8_BYTES = 4 * 1024 * 1024;
export const MAX_EMAIL_TEMPLATE_HTML_DEPTH = 32;
export const MAX_EMAIL_TEMPLATE_HTML_NODES = 1_000;
export const MAX_EMAIL_TEMPLATE_REQUEST_BYTES = 256 * 1024;

export const emailTemplateNameKey = (value: string): string =>
  value.normalize("NFKC").toLowerCase();

export interface EmailTemplate {
  readonly body: string;
  readonly createdAt: string;
  readonly htmlBody?: string;
  readonly id: TemplateId;
  readonly name: string;
  readonly subject: string;
  readonly updatedAt: string;
  readonly version: 1;
}

export interface EmailTemplateBook {
  readonly createdAt: string | null;
  readonly revision: string | null;
  readonly templates: readonly EmailTemplate[];
  readonly updatedAt: string | null;
  readonly version: 1;
}

export interface EmailTemplateOwner {
  readonly email: string;
  readonly providerId: string;
}

export type EmailTemplateCanonicalContent = Pick<
  EmailTemplate,
  "body" | "htmlBody" | "subject"
>;

export type EmailTemplateContentInput =
  | {
      readonly body: string;
      readonly mode: "plain";
      readonly subject: string;
    }
  | {
      readonly htmlBody: string;
      readonly mode: "rich";
      readonly subject: string;
    };

export type EmailTemplatePutOperation =
  | {
      readonly content: EmailTemplateContentInput;
      readonly expectedRevision: string | null;
      readonly name: string;
      readonly operation: "create";
    }
  | {
      readonly content: EmailTemplateContentInput;
      readonly expectedRevision: string | null;
      readonly name: string;
      readonly operation: "update";
      readonly templateId: TemplateId;
    }
  | {
      readonly expectedRevision: string | null;
      readonly operation: "delete";
      readonly templateId: TemplateId;
    };
